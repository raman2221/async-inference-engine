// Open-loop HTTP load generator for the inference pipeline.
//
// Phase 1 (ingress): fire POST /v1/infer at a fixed target rate for a fixed
// duration and measure how fast the gateway answers 202.
// Phase 2 (collect): poll a sample of the accepted jobs until they finish and
// report end-to-end latency, queue wait, inference time, and batch sizes using
// the timestamps the worker stamped on each result.
//
// "Open-loop" matters: each request has a *scheduled* send time and latency is
// measured from that time, not from when the thread got around to sending it.
// A closed-loop tester (send, wait, send) slows down when the server slows
// down and hides the very latency spikes we want to see ("coordinated
// omission").

#include <httplib.h>

#include <algorithm>
#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <map>
#include <mutex>
#include <optional>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

using Clock = std::chrono::steady_clock;
using std::chrono::duration_cast;
using std::chrono::microseconds;
using std::chrono::milliseconds;

struct Options {
  std::string url = "http://localhost:8080";
  double rps = 500;
  int duration_s = 10;
  int threads = 32;
  int collect = 1000;  // how many accepted jobs to track to completion (0 = skip)
  int collect_timeout_s = 180;
  std::string out;  // optional path for the JSON summary
};

struct Sample {
  int status;  // HTTP status, or -1 for a transport error
  int64_t latency_us;
  std::string job_id;
};

struct JobTiming {
  int64_t accepted_ms, started_ms, completed_ms;
  int batch_size;
  bool ok;
};

static const char* kTexts[] = {
    "This movie was absolutely wonderful, I loved every minute of it.",
    "Terrible service, I will never come back here again.",
    "The product works fine but shipping took forever.",
    "What a great experience, highly recommend to everyone.",
    "Honestly the worst purchase I have made this year.",
    "It was okay, nothing special but not bad either.",
    "The new update made the app fast and easy to use.",
    "I am disappointed with the quality of this item.",
};

static void usage() {
  std::puts(
      "usage: loadtest [--url URL] [--rps N] [--duration SEC] [--threads N]\n"
      "                [--collect N] [--collect-timeout SEC] [--out FILE]");
}

static Options parse_args(int argc, char** argv) {
  Options o;
  for (int i = 1; i < argc; ++i) {
    std::string a = argv[i];
    auto next = [&]() -> std::string {
      if (i + 1 >= argc) { usage(); std::exit(2); }
      return argv[++i];
    };
    if (a == "--url") o.url = next();
    else if (a == "--rps") o.rps = std::stod(next());
    else if (a == "--duration") o.duration_s = std::stoi(next());
    else if (a == "--threads") o.threads = std::stoi(next());
    else if (a == "--collect") o.collect = std::stoi(next());
    else if (a == "--collect-timeout") o.collect_timeout_s = std::stoi(next());
    else if (a == "--out") o.out = next();
    else { usage(); std::exit(a == "--help" ? 0 : 2); }
  }
  return o;
}

// The gateway and worker produce flat JSON we control, so a tiny field
// extractor beats pulling in a JSON library.
static std::optional<std::string> json_string(const std::string& body, const std::string& key) {
  auto pos = body.find("\"" + key + "\"");
  if (pos == std::string::npos) return std::nullopt;
  pos = body.find('"', body.find(':', pos) + 1);
  if (pos == std::string::npos) return std::nullopt;
  auto end = body.find('"', pos + 1);
  return body.substr(pos + 1, end - pos - 1);
}

static std::optional<int64_t> json_int(const std::string& body, const std::string& key) {
  auto pos = body.find("\"" + key + "\"");
  if (pos == std::string::npos) return std::nullopt;
  pos = body.find(':', pos) + 1;
  while (pos < body.size() && body[pos] == ' ') ++pos;
  return std::strtoll(body.c_str() + pos, nullptr, 10);
}

static double percentile(std::vector<double> v, double p) {
  if (v.empty()) return 0;
  std::sort(v.begin(), v.end());
  auto idx = static_cast<size_t>(p / 100.0 * (v.size() - 1) + 0.5);
  return v[std::min(idx, v.size() - 1)];
}

static double mean(const std::vector<double>& v) {
  if (v.empty()) return 0;
  double s = 0;
  for (double x : v) s += x;
  return s / v.size();
}

static std::unique_ptr<httplib::Client> make_client(const std::string& url) {
  auto c = std::make_unique<httplib::Client>(url);
  c->set_keep_alive(true);  // reuse TCP connections; no handshake per request
  c->set_connection_timeout(5);
  c->set_read_timeout(10);
  return c;
}

// ---------------------------------------------------------------- phase 1 --
static std::vector<Sample> run_ingress(const Options& o, double& elapsed_s) {
  const auto total = static_cast<int64_t>(o.rps * o.duration_s);
  const double interval_us = 1e6 / o.rps;
  std::vector<std::vector<Sample>> per_thread(o.threads);
  const auto start = Clock::now() + milliseconds(100);  // let threads spin up

  std::vector<std::thread> workers;
  for (int t = 0; t < o.threads; ++t) {
    workers.emplace_back([&, t] {
      auto client = make_client(o.url);
      auto& out = per_thread[t];
      out.reserve(total / o.threads + 1);
      // Request k is owned by thread k % threads and scheduled at k*interval.
      for (int64_t k = t; k < total; k += o.threads) {
        auto scheduled = start + microseconds(static_cast<int64_t>(k * interval_us));
        std::this_thread::sleep_until(scheduled);

        std::string body = std::string("{\"text\":\"") + kTexts[k % 8] + "\"}";
        auto res = client->Post("/v1/infer", body, "application/json");
        auto latency = duration_cast<microseconds>(Clock::now() - scheduled).count();

        Sample s{res ? res->status : -1, latency, {}};
        if (res && res->status == 202) s.job_id = json_string(res->body, "job_id").value_or("");
        out.push_back(std::move(s));
      }
    });
  }
  for (auto& w : workers) w.join();
  elapsed_s = std::chrono::duration<double>(Clock::now() - start).count();

  std::vector<Sample> all;
  for (auto& v : per_thread) all.insert(all.end(), v.begin(), v.end());
  return all;
}

// ---------------------------------------------------------------- phase 2 --
static std::vector<JobTiming> collect_results(const Options& o, const std::vector<std::string>& ids) {
  std::vector<JobTiming> timings;
  std::mutex mu;
  std::atomic<size_t> next{0};
  const auto deadline = Clock::now() + std::chrono::seconds(o.collect_timeout_s);

  std::vector<std::thread> workers;
  for (int t = 0; t < std::min(o.threads, 16); ++t) {
    workers.emplace_back([&] {
      auto client = make_client(o.url);
      for (size_t i; (i = next.fetch_add(1)) < ids.size();) {
        while (Clock::now() < deadline) {
          auto res = client->Get("/v1/jobs/" + ids[i]);
          if (res && res->status == 200) {
            auto status = json_string(res->body, "status").value_or("");
            if (status == "done" || status == "failed") {
              std::lock_guard lock(mu);
              timings.push_back({json_int(res->body, "accepted_at_ms").value_or(0),
                                 json_int(res->body, "started_at_ms").value_or(0),
                                 json_int(res->body, "completed_at_ms").value_or(0),
                                 static_cast<int>(json_int(res->body, "batch_size").value_or(0)),
                                 status == "done"});
              break;
            }
          }
          std::this_thread::sleep_for(milliseconds(50));
        }
      }
    });
  }
  for (auto& w : workers) w.join();
  return timings;
}

int main(int argc, char** argv) {
  const Options o = parse_args(argc, argv);
  std::printf("target: %s  rps=%.0f  duration=%ds  threads=%d\n", o.url.c_str(), o.rps, o.duration_s, o.threads);

  double elapsed_s = 0;
  auto samples = run_ingress(o, elapsed_s);

  int64_t accepted = 0, rejected_503 = 0, other = 0, errors = 0;
  std::vector<double> lat_ms;
  std::vector<std::string> ids;
  for (auto& s : samples) {
    lat_ms.push_back(s.latency_us / 1000.0);
    if (s.status == 202) { ++accepted; ids.push_back(s.job_id); }
    else if (s.status == 503) ++rejected_503;
    else if (s.status == -1) ++errors;
    else ++other;
  }
  const double success_pct = samples.empty() ? 0 : 100.0 * accepted / samples.size();

  std::printf("\n== ingress (gateway) ==\n");
  std::printf("sent %zu in %.2fs -> %.0f req/s achieved\n", samples.size(), elapsed_s, samples.size() / elapsed_s);
  std::printf("202 accepted: %lld (%.3f%%)  503: %lld  other: %lld  transport errors: %lld\n",
              (long long)accepted, success_pct, (long long)rejected_503, (long long)other, (long long)errors);
  std::printf("latency ms: p50=%.2f p90=%.2f p99=%.2f max=%.2f\n", percentile(lat_ms, 50),
              percentile(lat_ms, 90), percentile(lat_ms, 99), percentile(lat_ms, 100));

  // Evenly spaced sample across the run, so early and late jobs are both seen.
  std::vector<std::string> sample_ids;
  if (o.collect > 0 && !ids.empty()) {
    size_t n = std::min<size_t>(o.collect, ids.size());
    for (size_t i = 0; i < n; ++i) sample_ids.push_back(ids[i * ids.size() / n]);
  }

  std::vector<double> e2e, queue_wait, infer;
  std::map<int, int> batch_hist;
  int64_t failed = 0;
  if (!sample_ids.empty()) {
    std::printf("\ncollecting %zu results...\n", sample_ids.size());
    for (auto& t : collect_results(o, sample_ids)) {
      if (!t.ok) { ++failed; continue; }
      e2e.push_back(double(t.completed_ms - t.accepted_ms));
      queue_wait.push_back(double(t.started_ms - t.accepted_ms));
      infer.push_back(double(t.completed_ms - t.started_ms));
      batch_hist[t.batch_size]++;
    }
    std::printf("\n== end-to-end (accepted -> result written) ==\n");
    std::printf("completed %zu/%zu  failed %lld\n", e2e.size(), sample_ids.size(), (long long)failed);
    std::printf("e2e ms:        p50=%.1f p90=%.1f p99=%.1f mean=%.1f\n", percentile(e2e, 50),
                percentile(e2e, 90), percentile(e2e, 99), mean(e2e));
    std::printf("queue wait ms: p50=%.1f p99=%.1f\n", percentile(queue_wait, 50), percentile(queue_wait, 99));
    std::printf("inference ms:  p50=%.1f p99=%.1f\n", percentile(infer, 50), percentile(infer, 99));
    std::printf("batch sizes:  ");
    for (auto& [size, count] : batch_hist) std::printf(" %d:%d", size, count);
    std::printf("\n");
  }

  if (!o.out.empty()) {
    std::ostringstream j;
    j << "{\"rps_target\":" << o.rps << ",\"duration_s\":" << o.duration_s << ",\"sent\":" << samples.size()
      << ",\"achieved_rps\":" << samples.size() / elapsed_s << ",\"accepted\":" << accepted
      << ",\"rejected_503\":" << rejected_503 << ",\"errors\":" << errors + other
      << ",\"success_pct\":" << success_pct << ",\"ingress_p50_ms\":" << percentile(lat_ms, 50)
      << ",\"ingress_p99_ms\":" << percentile(lat_ms, 99) << ",\"completed\":" << e2e.size()
      << ",\"e2e_p50_ms\":" << percentile(e2e, 50) << ",\"e2e_p90_ms\":" << percentile(e2e, 90)
      << ",\"e2e_p99_ms\":" << percentile(e2e, 99) << ",\"e2e_mean_ms\":" << mean(e2e)
      << ",\"inference_p50_ms\":" << percentile(infer, 50) << "}";
    std::ofstream(o.out) << j.str() << "\n";
    std::printf("\nwrote %s\n", o.out.c_str());
  }
  return 0;
}

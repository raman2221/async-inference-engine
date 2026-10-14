// Open-loop load: request k has a fixed *scheduled* send time, and latency is
// measured from that time, not from when a thread got around to sending it.
// A closed-loop tester (send, wait, send) slows down when the server slows
// down and hides the very latency spikes we want to see. That error is called
// "coordinated omission".

#include "ingress.hpp"

#include <chrono>
#include <future>
#include <thread>

#include "http_client.hpp"
#include "json_fields.hpp"

namespace {

using Clock = std::chrono::steady_clock;

constexpr const char* kSampleTexts[] = {
    "This movie was absolutely wonderful, I loved every minute of it.",
    "Terrible service, I will never come back here again.",
    "The product works fine but shipping took forever.",
    "What a great experience, highly recommend to everyone.",
    "Honestly the worst purchase I have made this year.",
    "It was okay, nothing special but not bad either.",
    "The new update made the app fast and easy to use.",
    "I am disappointed with the quality of this item.",
};
constexpr size_t kSampleCount = std::size(kSampleTexts);

IngressSample send_one(httplib::Client& client, int64_t request_index, Clock::time_point scheduled) {
  std::string body = std::string("{\"text\":\"") + kSampleTexts[request_index % kSampleCount] + "\"}";
  auto response = client.Post("/v1/infer", body, "application/json");
  IngressSample sample;
  sample.latency_ms = std::chrono::duration<double, std::milli>(Clock::now() - scheduled).count();
  if (!response) return sample;
  sample.http_status = response->status;
  if (response->status == 202) sample.job_id = json_fields::read_string(response->body, "job_id").value_or("");
  return sample;
}

/** Thread `thread_index` owns requests thread_index, thread_index + threads, ... */
std::vector<IngressSample> send_share(const Options& options, int thread_index, Clock::time_point start) {
  const auto total = static_cast<int64_t>(options.rps * options.duration_s);
  const double interval_us = 1e6 / options.rps;
  auto client = make_client(options.url);
  std::vector<IngressSample> samples;
  for (int64_t k = thread_index; k < total; k += options.threads) {
    auto scheduled = start + std::chrono::microseconds(static_cast<int64_t>(k * interval_us));
    std::this_thread::sleep_until(scheduled);
    samples.push_back(send_one(*client, k, scheduled));
  }
  return samples;
}

void count_status(IngressReport& report, const IngressSample& sample) {
  if (!sample.http_status) ++report.transport_errors;
  else if (*sample.http_status == 202) ++report.accepted;
  else if (*sample.http_status == 503) ++report.rejected_503;
  else ++report.other_status;
}

}  // namespace

IngressReport run_ingress(const Options& options) {
  const auto start = Clock::now() + std::chrono::milliseconds(100);  // let threads spin up first
  std::vector<std::future<std::vector<IngressSample>>> shares;
  for (int t = 0; t < options.threads; ++t) {
    shares.push_back(std::async(std::launch::async, send_share, std::cref(options), t, start));
  }
  std::vector<IngressSample> samples;
  for (auto& share : shares) {
    auto part = share.get();
    samples.insert(samples.end(), part.begin(), part.end());
  }
  return summarize_ingress(samples, std::chrono::duration<double>(Clock::now() - start).count());
}

IngressReport summarize_ingress(const std::vector<IngressSample>& samples, double elapsed_s) {
  IngressReport report;
  report.sent = samples.size();
  report.elapsed_s = elapsed_s;
  std::vector<double> latencies;
  for (const auto& sample : samples) {
    count_status(report, sample);
    latencies.push_back(sample.latency_ms);
    if (!sample.job_id.empty()) report.job_ids.push_back(sample.job_id);
  }
  report.latency_ms = summarize(std::move(latencies));
  return report;
}

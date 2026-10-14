#include "completions.hpp"

#include <atomic>
#include <chrono>
#include <future>
#include <thread>

#include "http_client.hpp"
#include "json_fields.hpp"

namespace {

using Clock = std::chrono::steady_clock;
constexpr int kMaxPollingThreads = 16;
constexpr auto kPollInterval = std::chrono::milliseconds(50);

std::optional<JobTiming> poll_until_finished(httplib::Client& client, const std::string& job_id,
                                             Clock::time_point deadline) {
  while (Clock::now() < deadline) {
    auto response = client.Get("/v1/jobs/" + job_id);
    if (response && response->status == 200) {
      if (auto timing = parse_finished_job(response->body)) return timing;
    }
    std::this_thread::sleep_for(kPollInterval);
  }
  return std::nullopt;
}

/** Each polling thread claims the next unclaimed job id until none are left. */
std::vector<JobTiming> poll_claimed_jobs(const Options& options, const std::vector<std::string>& job_ids,
                                         std::atomic<size_t>& next_index) {
  const auto deadline = Clock::now() + std::chrono::seconds(options.collect_timeout_s);
  auto client = make_client(options.url);
  std::vector<JobTiming> timings;
  for (size_t i; (i = next_index.fetch_add(1)) < job_ids.size();) {
    if (auto timing = poll_until_finished(*client, job_ids[i], deadline)) timings.push_back(*timing);
  }
  return timings;
}

}  // namespace

std::vector<std::string> sample_evenly(const std::vector<std::string>& ids, size_t count) {
  const size_t n = std::min(count, ids.size());
  std::vector<std::string> sample;
  for (size_t i = 0; i < n; ++i) sample.push_back(ids[i * ids.size() / n]);
  return sample;
}

std::optional<JobTiming> parse_finished_job(const std::string& body) {
  auto status = json_fields::read_string(body, "status").value_or("");
  if (status != "done" && status != "failed") return std::nullopt;
  JobTiming timing;
  timing.accepted_ms = json_fields::read_int(body, "accepted_at_ms").value_or(0);
  timing.started_ms = json_fields::read_int(body, "started_at_ms").value_or(0);
  timing.completed_ms = json_fields::read_int(body, "completed_at_ms").value_or(0);
  timing.batch_size = static_cast<int>(json_fields::read_int(body, "batch_size").value_or(0));
  timing.succeeded = status == "done";
  return timing;
}

CompletionReport collect_completions(const Options& options, const std::vector<std::string>& job_ids) {
  std::atomic<size_t> next_index{0};
  std::vector<std::future<std::vector<JobTiming>>> pollers;
  for (int t = 0; t < std::min(options.threads, kMaxPollingThreads); ++t) {
    pollers.push_back(std::async(std::launch::async, poll_claimed_jobs, std::cref(options), std::cref(job_ids),
                                 std::ref(next_index)));
  }
  std::vector<JobTiming> timings;
  for (auto& poller : pollers) {
    auto part = poller.get();
    timings.insert(timings.end(), part.begin(), part.end());
  }
  return summarize_completions(timings, job_ids.size());
}

CompletionReport summarize_completions(const std::vector<JobTiming>& timings, size_t tracked) {
  CompletionReport report;
  report.tracked = tracked;
  std::vector<double> e2e, queue_wait, inference;
  for (const auto& t : timings) {
    if (!t.succeeded) {
      ++report.failed;
      continue;
    }
    e2e.push_back(static_cast<double>(t.completed_ms - t.accepted_ms));
    queue_wait.push_back(static_cast<double>(t.started_ms - t.accepted_ms));
    inference.push_back(static_cast<double>(t.completed_ms - t.started_ms));
    ++report.jobs_by_batch_size[t.batch_size];
  }
  report.completed = e2e.size();
  report.e2e_ms = summarize(std::move(e2e));
  report.queue_wait_ms = summarize(std::move(queue_wait));
  report.inference_ms = summarize(std::move(inference));
  return report;
}

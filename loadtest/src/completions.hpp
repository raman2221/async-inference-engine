#pragma once

#include <cstdint>
#include <map>
#include <optional>
#include <string>
#include <vector>

#include "options.hpp"
#include "stats.hpp"

/** Timestamps the worker stamped on a finished job record. */
struct JobTiming {
  int64_t accepted_ms = 0, started_ms = 0, completed_ms = 0;
  int batch_size = 0;
  bool succeeded = false;
};

struct CompletionReport {
  size_t tracked = 0;
  size_t completed = 0;
  int64_t failed = 0;
  Distribution e2e_ms, queue_wait_ms, inference_ms;
  std::map<int, int> jobs_by_batch_size;
};

/** Up to `count` ids spread evenly across the run, so early and late jobs are both represented. */
std::vector<std::string> sample_evenly(const std::vector<std::string>& ids, size_t count);

/** Parses a job record; empty while the job is still queued. */
std::optional<JobTiming> parse_finished_job(const std::string& body);

/** Phase 2: poll each job until it finishes (or the timeout passes) and summarize the timings. */
CompletionReport collect_completions(const Options& options, const std::vector<std::string>& job_ids);

CompletionReport summarize_completions(const std::vector<JobTiming>& timings, size_t tracked);

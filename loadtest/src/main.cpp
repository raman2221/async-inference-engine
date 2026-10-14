// Load generator for the inference pipeline.
//   Phase 1 (ingress): POST /v1/infer at a fixed rate; measure how fast the gateway answers 202.
//   Phase 2 (collect): follow a sample of accepted jobs to completion; report end-to-end latency,
//   queue wait, inference time, and batch sizes from the timestamps the worker stamps on each result.

#include <cstdio>
#include <stdexcept>

#include "completions.hpp"
#include "ingress.hpp"
#include "options.hpp"
#include "report.hpp"

namespace {

RunResult run(const Options& options) {
  std::printf("target: %s  rps=%.0f  duration=%ds  threads=%d\n", options.url.c_str(), options.rps,
              options.duration_s, options.threads);
  RunResult result{options, run_ingress(options), {}};
  print_ingress(result.ingress);

  if (options.collect > 0 && !result.ingress.job_ids.empty()) {
    auto tracked = sample_evenly(result.ingress.job_ids, static_cast<size_t>(options.collect));
    std::printf("\ncollecting %zu results...\n", tracked.size());
    result.completions = collect_completions(options, tracked);
    print_completions(result.completions);
  }
  return result;
}

}  // namespace

int main(int argc, char** argv) {
  if (wants_help(argc, argv)) {
    print_usage();
    return 0;
  }
  try {
    const Options options = parse_args(argc, argv);
    const RunResult result = run(options);
    if (!options.out.empty()) {
      write_json_file(options.out, result);
      std::printf("\nwrote %s\n", options.out.c_str());
    }
    return 0;
  } catch (const std::invalid_argument& e) {
    std::fprintf(stderr, "error: %s\n", e.what());
    print_usage();
    return 2;
  } catch (const std::exception& e) {
    std::fprintf(stderr, "error: %s\n", e.what());
    return 1;
  }
}

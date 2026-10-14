// Minimal dependency-free test runner: each TEST registers a function; main runs them all.

#include <cstdio>
#include <functional>
#include <stdexcept>
#include <string>
#include <vector>

#include "../src/completions.hpp"
#include "../src/ingress.hpp"
#include "../src/json_fields.hpp"
#include "../src/options.hpp"
#include "../src/stats.hpp"

namespace {

std::vector<std::pair<std::string, std::function<void()>>>& registry() {
  static std::vector<std::pair<std::string, std::function<void()>>> tests;
  return tests;
}

struct Register {
  Register(const char* name, std::function<void()> fn) { registry().emplace_back(name, std::move(fn)); }
};

#define TEST(name)                         \
  void name();                             \
  const Register register_##name{#name, name}; \
  void name()

#define EXPECT(condition) \
  if (!(condition)) throw std::runtime_error(std::string("expected: ") + #condition)

const std::string kRecord =
    R"({"job_id":"abc","status":"done","accepted_at_ms":1000,"started_at_ms":1040,"completed_at_ms":1070,"batch_size":16})";

TEST(read_string_finds_quoted_value) { EXPECT(json_fields::read_string(kRecord, "job_id") == "abc"); }

TEST(read_string_is_empty_for_missing_key) { EXPECT(!json_fields::read_string(kRecord, "nope")); }

TEST(read_int_parses_number) { EXPECT(json_fields::read_int(kRecord, "batch_size") == 16); }

TEST(read_int_is_empty_for_non_numeric_value) { EXPECT(!json_fields::read_int(kRecord, "status")); }

TEST(summarize_computes_percentiles_and_mean) {
  std::vector<double> values;
  for (int i = 1; i <= 100; ++i) values.push_back(i);

  auto d = summarize(values);

  EXPECT(d.p50 == 51 && d.p99 == 99 && d.max == 100 && d.mean == 50.5);
}

TEST(summarize_of_nothing_is_all_zero) { EXPECT(summarize({}).max == 0); }

TEST(parse_args_reads_flags) {
  const char* argv[] = {"loadtest", "--rps", "2000", "--url", "http://gw:8080"};

  auto options = parse_args(5, const_cast<char**>(argv));

  EXPECT(options.rps == 2000 && options.url == "http://gw:8080");
}

TEST(parse_args_rejects_unknown_flag) {
  const char* argv[] = {"loadtest", "--bogus", "1"};
  bool threw = false;
  try {
    parse_args(3, const_cast<char**>(argv));
  } catch (const std::invalid_argument&) {
    threw = true;
  }
  EXPECT(threw);
}

TEST(parse_args_rejects_non_numeric_value) {
  const char* argv[] = {"loadtest", "--rps", "fast"};
  bool threw = false;
  try {
    parse_args(3, const_cast<char**>(argv));
  } catch (const std::invalid_argument&) {
    threw = true;
  }
  EXPECT(threw);
}

TEST(sample_evenly_spreads_across_the_run) {
  std::vector<std::string> ids{"a", "b", "c", "d", "e", "f"};

  EXPECT((sample_evenly(ids, 3) == std::vector<std::string>{"a", "c", "e"}));
}

TEST(parse_finished_job_reads_timings) {
  auto timing = parse_finished_job(kRecord);

  EXPECT(timing && timing->completed_ms - timing->accepted_ms == 70 && timing->batch_size == 16);
}

TEST(parse_finished_job_is_empty_while_queued) {
  EXPECT(!parse_finished_job(R"({"job_id":"abc","status":"queued"})"));
}

TEST(summarize_ingress_counts_each_outcome) {
  std::vector<IngressSample> samples{{202, 1.0, "a"}, {503, 1.0, ""}, {std::nullopt, 1.0, ""}};

  auto report = summarize_ingress(samples, 1.0);

  EXPECT(report.accepted == 1 && report.rejected_503 == 1 && report.transport_errors == 1);
}

}  // namespace

int main() {
  int failures = 0;
  for (const auto& [name, test] : registry()) {
    try {
      test();
      std::printf("PASS %s\n", name.c_str());
    } catch (const std::exception& e) {
      ++failures;
      std::printf("FAIL %s: %s\n", name.c_str(), e.what());
    }
  }
  std::printf("%zu tests, %d failed\n", registry().size(), failures);
  return failures == 0 ? 0 : 1;
}

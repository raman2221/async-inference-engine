import { describe, expect, it } from "vitest";
import { JobSubmitter, QueueRejectedError, StoreUnavailableError } from "../src/submitter.js";
import { FakePublisher, FakeStore } from "./fakes.js";

function createSubmitter() {
  const publisher = new FakePublisher();
  const store = new FakeStore();
  return { submitter: new JobSubmitter(publisher, store, 60), publisher, store };
}

describe("JobSubmitter", () => {
  it("records the job as queued", async () => {
    const { submitter, store } = createSubmitter();

    const record = await submitter.submit("hello");

    expect(store.records.get(record.job_id)?.status).toBe("queued");
  });

  it("throws StoreUnavailableError and enqueues nothing when Redis is down", async () => {
    const { submitter, store, publisher } = createSubmitter();
    store.unavailable = true;

    await expect(submitter.submit("hello")).rejects.toBeInstanceOf(StoreUnavailableError);
    expect(publisher.published).toHaveLength(0);
  });

  it("marks the job failed and throws QueueRejectedError when the queue refuses it", async () => {
    const { submitter, store, publisher } = createSubmitter();
    publisher.rejectNext = true;

    await expect(submitter.submit("hello")).rejects.toBeInstanceOf(QueueRejectedError);
    expect([...store.records.values()][0].status).toBe("failed");
  });
});

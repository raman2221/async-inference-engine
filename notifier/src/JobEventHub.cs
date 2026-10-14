using System.Text.Json;

namespace Notifier;

/// <summary>
/// Routes job events to the sockets waiting on that job.
///
/// One Redis subscription per WebSocket would mean thousands of subscriptions
/// under load. Instead the process holds ONE subscription
/// (<see cref="RedisEventSubscriber"/>) and this hub fans events out in memory.
/// </summary>
public sealed class JobEventHub
{
    private readonly Dictionary<string, List<TaskCompletionSource<string>>> _waitersByJob = new();
    private readonly Lock _lock = new();

    public int WaitingJobs
    {
        get { lock (_lock) return _waitersByJob.Count; }
    }

    /// <summary>Starts listening for a job's final record. Dispose the waiter to stop.</summary>
    public Waiter Register(string jobId)
    {
        // RunContinuationsAsynchronously: completing this from the Redis
        // callback thread must not run the socket write on that thread.
        var completion = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        lock (_lock)
        {
            if (!_waitersByJob.TryGetValue(jobId, out var waiters))
                _waitersByJob[jobId] = waiters = [];
            waiters.Add(completion);
        }
        return new Waiter(this, jobId, completion);
    }

    /// <summary>Completes every waiter for the event's job, if the event is final. Ignores anything else.</summary>
    public void Dispatch(string eventJson)
    {
        if (!TryReadEvent(eventJson, out var jobId, out var status) || !IsFinalStatus(status)) return;

        List<TaskCompletionSource<string>>? waiters;
        lock (_lock)
        {
            if (!_waitersByJob.Remove(jobId, out waiters)) return;
        }
        foreach (var completion in waiters) completion.TrySetResult(eventJson);
    }

    public static bool IsFinal(string recordJson) =>
        TryReadEvent(recordJson, out _, out var status) && IsFinalStatus(status);

    private static bool IsFinalStatus(string status) => status is "done" or "failed";

    private static bool TryReadEvent(string json, out string jobId, out string status)
    {
        jobId = status = "";
        try
        {
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            jobId = root.TryGetProperty("job_id", out var id) ? id.GetString() ?? "" : "";
            status = root.TryGetProperty("status", out var s) ? s.GetString() ?? "" : "";
            return true;
        }
        catch (Exception e) when (e is JsonException or InvalidOperationException)
        {
            return false; // not JSON, or a field of the wrong type
        }
    }

    private void Unregister(string jobId, TaskCompletionSource<string> completion)
    {
        lock (_lock)
        {
            if (_waitersByJob.TryGetValue(jobId, out var waiters) && waiters.Remove(completion) && waiters.Count == 0)
                _waitersByJob.Remove(jobId);
        }
    }

    public sealed class Waiter(JobEventHub hub, string jobId, TaskCompletionSource<string> completion) : IDisposable
    {
        public Task<string> Result => completion.Task;

        public void Dispose() => hub.Unregister(jobId, completion);
    }
}

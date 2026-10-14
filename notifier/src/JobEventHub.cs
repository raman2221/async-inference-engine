using System.Text.Json;

namespace Notifier;

/// <summary>
/// Fans out Redis "job-events" messages to whoever is waiting on that job.
///
/// The naive design opens one Redis subscription per WebSocket. With
/// thousands of open sockets that is thousands of Redis subscriptions. Instead
/// this service holds ONE subscription and routes each event in memory to the
/// sockets waiting on that job id.
/// </summary>
public sealed class JobEventHub
{
    private readonly Dictionary<string, List<TaskCompletionSource<string>>> _waiters = new();
    private readonly object _lock = new();

    /// <summary>
    /// Registers interest in a job. Call this BEFORE checking Redis for an
    /// existing result; otherwise a result published between "check" and
    /// "register" would be missed and the client would hang.
    /// </summary>
    public Waiter Register(string jobId)
    {
        // RunContinuationsAsynchronously: completing the TCS from the Redis
        // callback thread must not run socket I/O on that thread.
        var tcs = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        lock (_lock)
        {
            if (!_waiters.TryGetValue(jobId, out var list))
            {
                list = new List<TaskCompletionSource<string>>();
                _waiters[jobId] = list;
            }
            list.Add(tcs);
        }
        return new Waiter(this, jobId, tcs);
    }

    /// <summary>Called for every message on the Redis channel.</summary>
    public void Dispatch(string json)
    {
        string? jobId;
        try
        {
            using var doc = JsonDocument.Parse(json);
            jobId = doc.RootElement.GetProperty("job_id").GetString();
        }
        catch (Exception e) when (e is JsonException or KeyNotFoundException or InvalidOperationException)
        {
            return; // ignore malformed events rather than crash the subscriber
        }
        if (jobId is null || !IsFinal(json)) return;

        List<TaskCompletionSource<string>>? list;
        lock (_lock)
        {
            if (!_waiters.Remove(jobId, out list)) return;
        }
        foreach (var tcs in list) tcs.TrySetResult(json);
    }

    public int WaitingJobs
    {
        get { lock (_lock) return _waiters.Count; }
    }

    public static bool IsFinal(string json)
    {
        try
        {
            using var doc = JsonDocument.Parse(json);
            var status = doc.RootElement.GetProperty("status").GetString();
            return status is "done" or "failed";
        }
        catch (Exception e) when (e is JsonException or KeyNotFoundException or InvalidOperationException)
        {
            return false;
        }
    }

    private void Unregister(string jobId, TaskCompletionSource<string> tcs)
    {
        lock (_lock)
        {
            if (_waiters.TryGetValue(jobId, out var list) && list.Remove(tcs) && list.Count == 0)
                _waiters.Remove(jobId);
        }
    }

    /// <summary>Disposing removes the registration so abandoned sockets don't leak memory.</summary>
    public sealed class Waiter(JobEventHub hub, string jobId, TaskCompletionSource<string> tcs) : IDisposable
    {
        public Task<string> Result => tcs.Task;
        public void Dispose() => hub.Unregister(jobId, tcs);
    }
}

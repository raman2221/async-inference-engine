using System.Net.WebSockets;
using System.Text;

namespace Notifier;

public sealed record StreamerOptions(TimeSpan WaitTimeout);

/// <summary>
/// Sends one job's result over a WebSocket: the current snapshot if it is
/// still queued, then the final record the moment the worker publishes it.
/// </summary>
public sealed class JobResultStreamer(JobEventHub hub, IJobResultSource results, StreamerOptions options)
{
    public const string NotFoundMessage = """{"status":"not_found"}""";
    public const string TimeoutMessage = """{"status":"timeout"}""";

    public async Task StreamAsync(WebSocket socket, string jobId, CancellationToken clientGone)
    {
        // Register BEFORE reading Redis. Reversed, a result published between
        // the read and the registration would be missed and the client would hang.
        using var waiter = hub.Register(jobId);
        var snapshot = await results.FindAsync(jobId);
        var finalRecord = await ResolveFinalRecordAsync(socket, waiter, snapshot, clientGone);
        await SendTextAsync(socket, finalRecord, clientGone);
        await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "done", CancellationToken.None);
    }

    private async Task<string> ResolveFinalRecordAsync(
        WebSocket socket, JobEventHub.Waiter waiter, string? snapshot, CancellationToken clientGone)
    {
        if (snapshot is null) return NotFoundMessage;
        if (JobEventHub.IsFinal(snapshot)) return snapshot;
        await SendTextAsync(socket, snapshot, clientGone);
        return await WaitForResultAsync(waiter, clientGone);
    }

    private async Task<string> WaitForResultAsync(JobEventHub.Waiter waiter, CancellationToken clientGone)
    {
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(clientGone);
        timeout.CancelAfter(options.WaitTimeout);
        try
        {
            return await waiter.Result.WaitAsync(timeout.Token);
        }
        catch (OperationCanceledException) when (!clientGone.IsCancellationRequested)
        {
            return TimeoutMessage;
        }
    }

    private static Task SendTextAsync(WebSocket socket, string text, CancellationToken cancellation) =>
        socket.SendAsync(Encoding.UTF8.GetBytes(text), WebSocketMessageType.Text, endOfMessage: true, cancellation);
}

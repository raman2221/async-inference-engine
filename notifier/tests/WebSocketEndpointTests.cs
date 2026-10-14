using System.Net.WebSockets;
using System.Text;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.Extensions.Hosting;
using Notifier;
using Xunit;

/// <summary>Runs the real endpoint in memory with a fake result source and no Redis.</summary>
public class WebSocketEndpointTests : IDisposable
{
    private const string JobId = "11111111-2222-3333-4444-555555555555";
    private const string Queued = $$"""{"job_id":"{{JobId}}","status":"queued"}""";
    private const string Done = $$"""{"job_id":"{{JobId}}","status":"done"}""";

    private readonly FakeResultSource _results = new();
    private readonly WebApplicationFactory<Program> _factory;

    public WebSocketEndpointTests()
    {
        _factory = new WebApplicationFactory<Program>().WithWebHostBuilder(web => web.ConfigureTestServices(services =>
        {
            services.RemoveAll<IHostedService>(); // no Redis subscription in tests
            services.AddSingleton<IJobResultSource>(_results);
            services.AddSingleton(new StreamerOptions(TimeSpan.FromMilliseconds(300)));
        }));
    }

    public void Dispose() => _factory.Dispose();

    [Fact]
    public async Task FinishedJobIsSentImmediately()
    {
        _results.Records[JobId] = Done;

        var messages = await ReceiveAllAsync(await ConnectAsync());

        Assert.Equal([Done], messages);
    }

    [Fact]
    public async Task QueuedJobSendsSnapshotThenPushedResult()
    {
        _results.Records[JobId] = Queued;
        var socket = await ConnectAsync();
        var first = await ReceiveAsync(socket);

        _factory.Services.GetRequiredService<JobEventHub>().Dispatch(Done);

        Assert.Equal([Queued, Done], [first, .. await ReceiveAllAsync(socket)]);
    }

    [Fact]
    public async Task UnknownJobGetsNotFound()
    {
        var messages = await ReceiveAllAsync(await ConnectAsync());

        Assert.Equal([JobResultStreamer.NotFoundMessage], messages);
    }

    [Fact]
    public async Task JobThatNeverFinishesTimesOut()
    {
        _results.Records[JobId] = Queued;

        var messages = await ReceiveAllAsync(await ConnectAsync());

        Assert.Equal([Queued, JobResultStreamer.TimeoutMessage], messages);
    }

    private Task<WebSocket> ConnectAsync() =>
        _factory.Server.CreateWebSocketClient().ConnectAsync(new Uri($"ws://localhost/ws/jobs/{JobId}"), default);

    private static async Task<List<string>> ReceiveAllAsync(WebSocket socket)
    {
        var messages = new List<string>();
        for (var message = await ReceiveAsync(socket); message is not null; message = await ReceiveAsync(socket))
            messages.Add(message);
        return messages;
    }

    private static async Task<string?> ReceiveAsync(WebSocket socket)
    {
        var buffer = new byte[4096];
        var result = await socket.ReceiveAsync(buffer, default);
        return result.MessageType == WebSocketMessageType.Close ? null : Encoding.UTF8.GetString(buffer, 0, result.Count);
    }

    private sealed class FakeResultSource : IJobResultSource
    {
        public Dictionary<string, string> Records { get; } = new();

        public Task<string?> FindAsync(string jobId) => Task.FromResult(Records.GetValueOrDefault(jobId));
    }
}

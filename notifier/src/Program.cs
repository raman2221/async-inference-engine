using System.Net.WebSockets;
using System.Text;
using System.Text.RegularExpressions;
using Notifier;
using StackExchange.Redis;

// Result-delivery service: clients open ws://.../ws/jobs/{id} and get the
// result pushed the moment the worker finishes, instead of polling.

var builder = WebApplication.CreateBuilder(args);
var redisUrl = builder.Configuration["REDIS_URL"] ?? "localhost:6379";
var waitTimeout = TimeSpan.FromSeconds(int.Parse(builder.Configuration["WAIT_TIMEOUT_SECONDS"] ?? "120"));

// "redis://host:port" (what the other services use) -> "host:port" (what
// StackExchange.Redis expects).
var redisConfig = redisUrl.Replace("redis://", "");
var options = ConfigurationOptions.Parse(redisConfig);
options.AbortOnConnectFail = false; // keep retrying while Redis boots
var redis = await ConnectionMultiplexer.ConnectAsync(options);

var hub = new JobEventHub();
builder.Services.AddSingleton(hub);
builder.Services.AddSingleton<IConnectionMultiplexer>(redis);

var app = builder.Build();
app.UseWebSockets(new WebSocketOptions { KeepAliveInterval = TimeSpan.FromSeconds(15) });

// One subscription for the whole process; JobEventHub routes events in memory.
await redis.GetSubscriber().SubscribeAsync(
    RedisChannel.Literal("job-events"),
    (_, message) => hub.Dispatch(message.ToString()));

var jobIdPattern = new Regex("^[0-9a-f-]{36}$", RegexOptions.Compiled);

app.Map("/ws/jobs/{jobId}", async (HttpContext context, string jobId) =>
{
    if (!context.WebSockets.IsWebSocketRequest)
        return Results.BadRequest(new { error = "expected a WebSocket upgrade" });
    if (!jobIdPattern.IsMatch(jobId))
        return Results.BadRequest(new { error = "invalid job id" });

    using var socket = await context.WebSockets.AcceptWebSocketAsync();

    // 1) Register first, 2) then check Redis. This order closes the race
    // where the result lands between the check and the registration.
    using var waiter = hub.Register(jobId);
    var existing = await redis.GetDatabase().StringGetAsync($"job:{jobId}");

    string payload;
    if (existing.HasValue && JobEventHub.IsFinal(existing.ToString()))
    {
        payload = existing.ToString();
    }
    else if (existing.IsNull)
    {
        payload = """{"status":"not_found"}""";
    }
    else
    {
        // Let the client know we're connected and waiting, then block until
        // the worker publishes, the client disconnects, or we time out.
        await SendText(socket, existing.ToString(), context.RequestAborted);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(context.RequestAborted);
        timeout.CancelAfter(waitTimeout);
        try
        {
            payload = await waiter.Result.WaitAsync(timeout.Token);
        }
        catch (OperationCanceledException) when (!context.RequestAborted.IsCancellationRequested)
        {
            payload = """{"status":"timeout"}""";
        }
        catch (OperationCanceledException)
        {
            return Results.Empty; // client went away
        }
    }

    await SendText(socket, payload, context.RequestAborted);
    await socket.CloseAsync(WebSocketCloseStatus.NormalClosure, "done", CancellationToken.None);
    return Results.Empty;
});

app.MapGet("/healthz", () => Results.Ok(new { ok = redis.IsConnected, waiting_jobs = hub.WaitingJobs }));

app.Run();

static Task SendText(WebSocket socket, string text, CancellationToken ct) =>
    socket.SendAsync(Encoding.UTF8.GetBytes(text), WebSocketMessageType.Text, endOfMessage: true, ct);

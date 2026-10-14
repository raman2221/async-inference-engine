using System.Text.RegularExpressions;
using StackExchange.Redis;

namespace Notifier;

/// <summary>Composition root: all construction happens here, so the classes above only use their dependencies.</summary>
public static partial class NotifierSetup
{
    [GeneratedRegex("^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$")]
    private static partial Regex JobIdPattern();

    public static IServiceCollection AddNotifier(this IServiceCollection services, IConfiguration config)
    {
        var waitTimeout = TimeSpan.FromSeconds(config.GetValue("WAIT_TIMEOUT_SECONDS", 120));
        services.AddSingleton<IConnectionMultiplexer>(_ => ConnectRedis(config["REDIS_URL"] ?? "localhost:6379"));
        services.AddSingleton<JobEventHub>();
        services.AddSingleton<IJobResultSource, RedisJobResultSource>();
        services.AddSingleton(new StreamerOptions(waitTimeout));
        services.AddSingleton<JobResultStreamer>();
        services.AddHostedService<RedisEventSubscriber>();
        return services;
    }

    public static void MapNotifierEndpoints(this WebApplication app)
    {
        app.Map("/ws/jobs/{jobId}", StreamJobAsync);
        app.MapGet("/healthz", (IConnectionMultiplexer redis, JobEventHub hub) =>
            Results.Ok(new { ok = redis.IsConnected, waiting_jobs = hub.WaitingJobs }));
    }

    private static async Task<IResult> StreamJobAsync(HttpContext context, string jobId, JobResultStreamer streamer)
    {
        if (!context.WebSockets.IsWebSocketRequest)
            return Results.BadRequest(new { error = "expected a WebSocket upgrade" });
        if (!JobIdPattern().IsMatch(jobId))
            return Results.BadRequest(new { error = "invalid job id" });

        using var socket = await context.WebSockets.AcceptWebSocketAsync();
        try
        {
            await streamer.StreamAsync(socket, jobId, context.RequestAborted);
        }
        catch (OperationCanceledException) when (context.RequestAborted.IsCancellationRequested)
        {
            // The client disconnected while waiting; nothing left to send.
        }
        return Results.Empty;
    }

    private static ConnectionMultiplexer ConnectRedis(string url)
    {
        // The other services use "redis://host:port"; StackExchange.Redis wants "host:port".
        var options = ConfigurationOptions.Parse(url.Replace("redis://", ""));
        options.AbortOnConnectFail = false; // keep retrying while Redis boots
        return ConnectionMultiplexer.Connect(options);
    }
}

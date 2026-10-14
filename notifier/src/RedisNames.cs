namespace Notifier;

/// <summary>Names shared with the gateway (TypeScript) and worker (Python). Change all three together.</summary>
public static class RedisNames
{
    public const string EventsChannel = "job-events";

    public static string JobKey(string jobId) => $"job:{jobId}";
}

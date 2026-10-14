using StackExchange.Redis;

namespace Notifier;

/// <summary>Reads the current job record JSON. Null means the job is unknown or expired.</summary>
public interface IJobResultSource
{
    Task<string?> FindAsync(string jobId);
}

public sealed class RedisJobResultSource(IConnectionMultiplexer redis) : IJobResultSource
{
    public async Task<string?> FindAsync(string jobId)
    {
        var value = await redis.GetDatabase().StringGetAsync(RedisNames.JobKey(jobId));
        return value.HasValue ? value.ToString() : null;
    }
}

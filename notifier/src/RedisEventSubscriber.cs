using StackExchange.Redis;

namespace Notifier;

/// <summary>
/// Holds the process's single Redis subscription and forwards every event to
/// the hub, which routes it in memory to the sockets waiting on that job.
/// </summary>
public sealed class RedisEventSubscriber(IConnectionMultiplexer redis, JobEventHub hub) : IHostedService
{
    private static readonly RedisChannel Channel = RedisChannel.Literal(RedisNames.EventsChannel);

    public Task StartAsync(CancellationToken cancellationToken) =>
        redis.GetSubscriber().SubscribeAsync(Channel, (_, message) => hub.Dispatch(message.ToString()));

    public Task StopAsync(CancellationToken cancellationToken) =>
        redis.GetSubscriber().UnsubscribeAsync(Channel);
}

using Notifier;
using Xunit;

public class JobEventHubTests
{
    private const string Done = """{"job_id":"a","status":"done","result":{"label":"POSITIVE","score":0.99}}""";

    [Fact]
    public async Task DeliversFinalEventToEveryWaiterForThatJob()
    {
        var hub = new JobEventHub();
        using var first = hub.Register("a");
        using var second = hub.Register("a");
        using var other = hub.Register("b");

        hub.Dispatch(Done);

        Assert.Equal(Done, await first.Result);
        Assert.Equal(Done, await second.Result);
        Assert.False(other.Result.IsCompleted);
        Assert.Equal(1, hub.WaitingJobs); // "a" cleaned up, "b" still waiting
    }

    [Fact]
    public void IgnoresNonFinalAndMalformedEvents()
    {
        var hub = new JobEventHub();
        using var waiter = hub.Register("a");

        hub.Dispatch("""{"job_id":"a","status":"queued"}""");
        hub.Dispatch("not json");
        hub.Dispatch("""{"status":"done"}""");

        Assert.False(waiter.Result.IsCompleted);
    }

    [Fact]
    public void DisposingAWaiterUnregistersIt()
    {
        var hub = new JobEventHub();
        var waiter = hub.Register("a");
        waiter.Dispose();
        Assert.Equal(0, hub.WaitingJobs);
    }

    [Theory]
    [InlineData("""{"status":"done"}""", true)]
    [InlineData("""{"status":"failed"}""", true)]
    [InlineData("""{"status":"queued"}""", false)]
    [InlineData("""{}""", false)]
    public void IsFinalRecognisesTerminalStatuses(string json, bool expected) =>
        Assert.Equal(expected, JobEventHub.IsFinal(json));
}

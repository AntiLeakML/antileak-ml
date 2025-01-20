export async function sendDiscordNotification(
  webhookUrl: string,
  message: string
): Promise<void> {
  try {
    const fetch = (await import("node-fetch")).default;

    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content: message }),
    });

    if (!response.ok) {
      console.error(
        `Failed to send Discord notification: ${response.statusText}`
      );
    } else {
      console.log("Discord notification sent successfully.");
    }
  } catch (error) {
    console.error(
      `Error sending Discord notification: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
}

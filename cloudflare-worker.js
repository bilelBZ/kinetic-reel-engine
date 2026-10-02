/**
 * Cloudflare Worker (100% Gratuit, 0€, AUCUNE carte bancaire)
 * Reçoit le message Telegram et déclenche le workflow GitHub Actions
 */

export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("OK", { status: 200 });
    }

    try {
      const update = await request.json();
      const message = update.message;
      if (!message || !message.text) return new Response("OK", { status: 200 });

      const chatId = message.chat.id;
      const text = message.text.trim();

      if (text.startsWith("/start") || text.startsWith("/help")) {
        await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chat_id: chatId,
            text: "👋 Envoyez-moi votre idée de vidéo, et GitHub Cloud va lancer la génération et vous envoyer le MP4 !",
          }),
        });
        return new Response("OK", { status: 200 });
      }

      // 1. Accuser réception sur Telegram
      await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: `🎬 *Demande reçue !*\n\n📌 Sujet : ${text}\n⏳ _La machine GitHub Cloud (16 Go RAM) démarre le calcul... Votre vidéo arrive dans environ 1 minute !_`,
          parse_mode: "Markdown",
        }),
      });

      // 2. Déclencher GitHub Actions via l'API GitHub
      const ghRes = await fetch(
        `https://api.github.com/repos/${env.GITHUB_REPO}/actions/workflows/generate-reel.yml/dispatches`,
        {
          method: "POST",
          headers: {
            "Accept": "application/vnd.github.v3+json",
            "Authorization": `Bearer ${env.GITHUB_PAT}`,
            "User-Agent": "Telegram-Kinetic-Bot",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            ref: "main",
            inputs: {
              topic: text,
              duration: "30",
              voice: "Puck",
              chat_id: String(chatId),
            },
          }),
        }
      );

      return new Response("Triggered", { status: 200 });
    } catch (err) {
      return new Response("Error: " + err.message, { status: 500 });
    }
  },
};

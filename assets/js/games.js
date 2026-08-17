/* ============================================================
   GAMES - single source of truth.
   Add or edit a game here and it shows up on the home grid,
   the "Feeling lucky" spin, and its own page (game.html?game=slug).

   To wire a real playable demo, set `demoUrl` to the iframe URL
   your provider gives you. Leave it "" to show the polite fallback.

   Replace the picsum image URLs with your real game art:
   poster ~ 900x1200, screenshots ~ 1600x1000.
   ============================================================ */

window.RONI_GAMES = [
  {
    slug: "gladiator-8df189fe1030b111",
    title: "Gladiator",
    category: "Crash × Slot hybrid",
    tagline: "Crash × Slot hybrid. Loot gear, stack multipliers, cash out or risk it.",
    description:
      "A crash × slot hybrid set in the roar of the colosseum. Win automated fights to loot gear that stacks your multiplier, then cash out or risk it for more. Crash-style tension meets the dopamine of opening a case. A daily Star Arena turns every session into a live race for the prize pool.",
    poster: "assets/glad-poster.webp",
    video: "assets/glad-showcase.mp4",
    shots: [
      "assets/glad-1.webp",
      "assets/glad-2.webp",
      "assets/glad-3.webp",
      "assets/glad-4.webp"
    ],
    rtp: "96%",
    volatility: "Configurable",
    layout: "Round-based 1v1",
    maxWin: "1,000x",
    features: ["Cash-out", "Loot reel", "Stacking multipliers", "Daily Arena", "Provably fair"],
    demoUrl: "https://play.ronigames.org/client/web/index.html",
    sheet: "assets/glad/GAME-SHEET.en.html",
    // Hidden from the public site. Reachable only via /game/gladiator-8df189fe1030b111
    hidden: true
  },
  {
    slug: "redline-rush-a9c84db8266ed07a",
    title: "Redline Rush",
    category: "Multiplayer crash racing",
    tagline: "Crash racing. Back a car, ride the multiplier, cash out before it breaks down.",
    description:
      "A real-time crash game wrapped in a racing show. Back a car, watch the multiplier climb as the field races, and cash out before your car breaks down. One shared round runs for everyone, with a live drivers panel and chat. Strategy-proof 97% RTP and provably fair on every round.",
    poster: "assets/rr-poster.webp",
    video: "assets/rr-showcase.mp4",
    shots: [
      "assets/rr-1.webp",
      "assets/rr-2.webp",
      "assets/rr-3.webp"
    ],
    rtp: "97%",
    volatility: "Medium-High",
    layout: "Real-time crash",
    maxWin: "10,000x",
    features: ["Real-time multiplayer", "Auto cash-out", "Up to 2 bets", "Live chat", "Provably fair"],
    demoUrl: "assets/redlinerush-d9f1fc45a4efb18d96e9/index.html",
    sheet: "assets/redlinerush-d9f1fc45a4efb18d96e9/GAME-SHEET.en.html",
    // Hidden from the public site. Reachable only via /game/redline-rush-a9c84db8266ed07a
    hidden: true
  }
];

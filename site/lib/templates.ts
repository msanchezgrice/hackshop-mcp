// 25 project templates that prime the propose_hardware tool.
//
// Each entry includes a `viability` field documenting whether the underlying
// hack is real (community-verified path), iffy (works but with caveats), or
// experimental (worth trying but expect to bushwhack). The viability note is
// surfaced on the templates page so users can see what they're getting into
// before clicking through to the agent.

export interface Template {
  slug: string;
  title: string;
  blurb: string;            // one-line teaser shown on cards
  prompt: string;           // submitted to /api/propose
  difficulty: 1 | 2 | 3 | 4 | 5;
  viability: "verified" | "iffy" | "experimental";
  viability_note: string;   // why I gave that rating
  // Estimated total parts cost (used market) for the typical build, USD.
  // Excludes shipping and tools you probably already own. Conservative
  // upper bound based on training-data eBay norms.
  est_cost_usd: { min: number; max: number };
  category:
    | "display"
    | "audio"
    | "camera"
    | "smart-home"
    | "robotics"
    | "network"
    | "compute"
    | "retro";
}

export const TEMPLATES: Template[] = [
  // ─── DISPLAY / AMBIENT ────────────────────────────────────────────────
  {
    slug: "old-phone-as-clock",
    title: "Old phone as an always-on clock",
    blurb: "Dock that ancient iPhone or Pixel as a bedside or kitchen clock with weather and the next calendar event.",
    prompt:
      "Repurpose an old smartphone as an always-on bedside or kitchen clock. Large legible numerals, dims at night, optional weather and next-calendar-event overlay. Battery-friendly enough to stay docked permanently.",
    difficulty: 1,
    est_cost_usd: { min: 0, max: 50 },
    viability: "verified",
    viability_note:
      "iOS 17+ ships StandBy mode natively. Android has Always-On-Display and apps like Always On AMOLED or AlwaysOnPhotoFrame. Kiosk apps lock the screen.",
    category: "display",
  },
  {
    slug: "epaper-family-calendar",
    title: "E-paper family calendar for the kitchen wall",
    blurb: "Waveshare 7.5\" + Pi Zero W pulling Google Calendar, refresh once an hour, light colors, no animation.",
    prompt:
      "Always-on family calendar for the kitchen wall. E-paper preferred so it can sit in a frame, light colors, no animation, ideally 7-13 inch with low refresh cadence. Pulls Google Calendar.",
    difficulty: 2,
    est_cost_usd: { min: 80, max: 130 },
    viability: "verified",
    viability_note:
      "MagInkCal and InkyPi are mature open-source projects targeting exactly this build. Waveshare 7.5\" + Pi Zero W is the canonical combo.",
    category: "display",
  },
  {
    slug: "bricked-frame-revival",
    title: "Bring a bricked digital picture frame back to life",
    blurb: "The Electric Objects EO1 hack: SSH in via a stock-firmware bug, run your own slideshow.",
    prompt:
      "Revive a bricked or abandoned digital picture frame to display custom artwork or a generative image feed. Wall-mountable, sub-$300 secondary-market budget, must support custom firmware or remote shell access.",
    difficulty: 3,
    est_cost_usd: { min: 80, max: 200 },
    viability: "verified",
    viability_note:
      "Electric Objects EO1 has a public revival project (dasl-/electric-objects-revival). Founder did this hack personally — ~6 hours with Claude assistance.",
    category: "display",
  },
  {
    slug: "ipad-smart-home-panel",
    title: "Old iPad as a smart home control panel",
    blurb: "iPad 2 in Guided Access mode, Home Assistant dashboard, mounted on the wall.",
    prompt:
      "Wall-mounted smart-home control panel for lights, thermostat, music. Always-on touchscreen, prefer something cheap and disposable on eBay rather than buying new. Should work with Home Assistant or Hubitat.",
    difficulty: 2,
    est_cost_usd: { min: 30, max: 80 },
    viability: "verified",
    viability_note:
      "iPad 2/3/4 cost $30-60 used. Guided Access locks one app to fullscreen. Home Assistant Companion app and Hubitat dashboards are the standard targets. No jailbreak required.",
    category: "smart-home",
  },
  {
    slug: "tidbyt-now-playing",
    title: "Tidbyt as a Spotify 'now playing' pixel display",
    blurb: "64x32 LED matrix on your shelf showing album art for whatever's currently spinning.",
    prompt:
      "Always-on pixel-art display showing what's currently playing on Spotify or Apple Music. Sits on a shelf, nostalgic LED-matrix vibe, runs without paying a cloud subscription.",
    difficulty: 2,
    est_cost_usd: { min: 150, max: 200 },
    viability: "verified",
    viability_note:
      "Tidbyt's official Pixlet SDK supports this; the Tronbyt fork hosts your own server so no subscription required. Spotify integration is well-documented.",
    category: "display",
  },
  {
    slug: "pebble-time-dashboard",
    title: "Pebble Time as a notification + status watch",
    blurb: "$30 e-paper smartwatch with week-long battery, kept alive by the Rebble community.",
    prompt:
      "E-ink smartwatch for notifications, calendar glances, and habit tracking. Week-long battery, prefer something cheap on the secondary market with an active community keeping it alive.",
    difficulty: 2,
    est_cost_usd: { min: 30, max: 60 },
    viability: "verified",
    viability_note:
      "Rebble.io took over the cloud after Fitbit shut down Pebble. Watchfaces, app store, and SDK all functional today. Pebble Time goes for $30-60 on eBay.",
    category: "display",
  },
  {
    slug: "boox-recipe-display",
    title: "Boox Poke 3 as a kitchen recipe display",
    blurb: "Stock-Android e-reader sideloaded with a recipe app, splash-resistant in a kitchen mount.",
    prompt:
      "Recipe display in the kitchen — readable in bright light, doesn't glare, can run a recipe app or web view. Bonus if it can survive a splash. Prefer e-reader form factor over LCD.",
    difficulty: 1,
    est_cost_usd: { min: 90, max: 160 },
    viability: "verified",
    viability_note:
      "Boox runs stock Android with Google Play. Sideload Paprika, Kitchen Stories, or just point Chrome at a Notion recipe page. No jailbreak needed.",
    category: "display",
  },

  // ─── CAMERA / SENSOR ──────────────────────────────────────────────────
  {
    slug: "old-phone-baby-monitor",
    title: "Old phone as a baby monitor",
    blurb: "Repurpose a drawer phone with Cloud Baby Monitor or Alfred Camera over Wi-Fi.",
    prompt:
      "Reuse an old smartphone as a baby monitor camera. Already has a camera, mic, and Wi-Fi. Should stream to my main phone over local network or internet, with motion/audio alerts.",
    difficulty: 1,
    est_cost_usd: { min: 0, max: 50 },
    viability: "verified",
    viability_note:
      "Cloud Baby Monitor (iOS) and Alfred Camera (cross-platform) are off-the-shelf apps. Both work with phones from the last ~8 years. No firmware hack needed.",
    category: "camera",
  },
  {
    slug: "old-phone-doorbell",
    title: "Old phone as a doorbell camera",
    blurb: "Mount it in a window, motion-trigger alerts, no Ring subscription.",
    prompt:
      "DIY doorbell camera using an old smartphone mounted in a window facing the front door. Motion-triggered alerts, optional cloud recording, must work with iOS or Android phones from the last 5 years.",
    difficulty: 2,
    est_cost_usd: { min: 0, max: 50 },
    viability: "verified",
    viability_note:
      "Alfred Camera, Manything, or Home Assistant + WebRTC. Works for any phone with a camera. Power via wired USB (no battery worry).",
    category: "camera",
  },
  {
    slug: "wyze-cam-no-cloud",
    title: "Wyze Cam v2 without the cloud",
    blurb: "Flash openmiko, get RTSP, run it through Frigate or Home Assistant locally.",
    prompt:
      "$25 cloud camera I want to run without the manufacturer's cloud. Need RTSP stream so I can pipe it into Frigate or Home Assistant. Local-only, no subscription.",
    difficulty: 3,
    est_cost_usd: { min: 15, max: 30 },
    viability: "verified",
    viability_note:
      "openmiko (github.com/openmiko/openmiko) and WyzeHacks both work on Wyze Cam v2. RTSP firmware path is documented. v3+ harder.",
    category: "camera",
  },
  {
    slug: "dslr-as-webcam",
    title: "Old DSLR as a 4K webcam",
    blurb: "Magic Lantern firmware on a Canon Rebel turns it into the best webcam you'll ever own.",
    prompt:
      "Repurpose an old DSLR or mirrorless camera as a high-quality webcam for video calls or streaming. Bonus if it can run unattended for hours without overheating. Want clean HDMI out or USB.",
    difficulty: 3,
    est_cost_usd: { min: 100, max: 300 },
    viability: "verified",
    viability_note:
      "Magic Lantern adds video features to many Canon DSLRs. Most Canon/Sony/Nikon offer official webcam utilities now (post-2020). Older bodies need an HDMI capture card. Brick risk on Magic Lantern is real but recoverable on most models.",
    category: "camera",
  },
  {
    slug: "pi-zero-wildlife-cam",
    title: "Pi Zero W as a wildlife / squirrel cam",
    blurb: "Pi Zero W + camera module, motion-trigger, solar-powered if you want.",
    prompt:
      "Outdoor wildlife camera in the backyard. Motion-triggered video capture, weatherproof enclosure, low power so it can run on solar or a big battery for weeks at a time.",
    difficulty: 2,
    est_cost_usd: { min: 30, max: 80 },
    viability: "verified",
    viability_note:
      "Pi Zero W + Pi Camera v2 + motioneye or motionEye OS. Solar setups documented widely. The build is the standard 'tinker outdoor' project.",
    category: "camera",
  },

  // ─── AUDIO ────────────────────────────────────────────────────────────
  {
    slug: "echo-dot-aux-speaker",
    title: "Echo Dot as a wired aux speaker",
    blurb: "Skip Alexa entirely — use the 3.5mm output, plug into your real speakers.",
    prompt:
      "Repurpose an Amazon Echo Dot (2nd or 3rd gen) as a wired Bluetooth speaker source for my real bookshelf speakers. Skip Alexa entirely — use the 3.5mm output only. No firmware hack required.",
    difficulty: 1,
    est_cost_usd: { min: 10, max: 30 },
    viability: "verified",
    viability_note:
      "Echo Dot has a 3.5mm aux out. Pair it as a Bluetooth speaker, output to your amp. Trivial. The harder firmware-hack path exists too if you want to remove Amazon entirely.",
    category: "audio",
  },
  {
    slug: "phone-spotify-speaker",
    title: "Old phone as a Spotify Connect speaker",
    blurb: "Old phone + a powered speaker = wireless multiroom audio for nothing.",
    prompt:
      "Make a wireless multiroom speaker using an old smartphone connected to a powered speaker. Should appear as a Spotify Connect target so any device on the network can stream to it.",
    difficulty: 1,
    est_cost_usd: { min: 0, max: 50 },
    viability: "verified",
    viability_note:
      "Spotify Connect on phones is native. Pair phone + speaker via 3.5mm or Bluetooth, leave it docked. Multiple phones = multiple zones. No code required.",
    category: "audio",
  },
  {
    slug: "laptop-music-server",
    title: "Old laptop as a household music server",
    blurb: "Plex / Navidrome / LMS — your music library streamed to any device.",
    prompt:
      "Self-hosted music streaming server running on an old laptop. Should serve my FLAC/MP3 library to phones around the house, support Spotify-style playlists, and not require a subscription.",
    difficulty: 2,
    est_cost_usd: { min: 50, max: 150 },
    viability: "verified",
    viability_note:
      "Navidrome (open source, Subsonic-compatible apps everywhere), Plex Music, or Logitech Media Server all run on a 10-year-old laptop. Common homelab project.",
    category: "audio",
  },

  // ─── ROBOTICS / MOBILITY ──────────────────────────────────────────────
  {
    slug: "roomba-as-robot",
    title: "Roomba as a mobile robot platform",
    blurb: "iRobot Create cable + ROS, drive a Pi-on-Roomba around your house.",
    prompt:
      "Convert a Roomba into a programmable mobile robot platform. I want to drive it from a Pi or laptop, mount sensors, and use it as a teaching/hacking platform for ROS or basic mobile robotics.",
    difficulty: 4,
    est_cost_usd: { min: 90, max: 180 },
    viability: "verified",
    viability_note:
      "iRobot publishes the Open Interface (OI) protocol via the mini-DIN cable. Create 2 was sold as a hacking platform. ROS roomba_robot package exists. 600/700/800 series Roombas all work with the cable.",
    category: "robotics",
  },
  // ─── NETWORK / INFRASTRUCTURE ─────────────────────────────────────────
  {
    slug: "router-as-pihole",
    title: "Old router as a Pi-hole DNS filter",
    blurb: "OpenWrt + adblock package on a $20 router, network-wide ad blocking.",
    prompt:
      "Network-wide ad blocking for the whole house. I'd rather use an old router I have lying around than buy a new device. Should be set-and-forget once configured.",
    difficulty: 3,
    est_cost_usd: { min: 10, max: 30 },
    viability: "iffy",
    viability_note:
      "OpenWrt + adblock works on routers with ≥16MB flash + 64MB RAM. Many cheap routers fall short. Pi-hole proper needs a Pi or x86 box. Check your specific router's hardware revision before buying.",
    category: "network",
  },
  {
    slug: "wyse-proxmox-node",
    title: "Wyse 5070 thin client as a Proxmox node",
    blurb: "$60 fanless x86 box runs your homelab VMs without making a sound.",
    prompt:
      "Build a quiet, low-power homelab server for running 3-5 VMs (Home Assistant, Pi-hole, Plex). Want something fanless and cheap, ideally x86 so I can run any Linux distro.",
    difficulty: 1,
    est_cost_usd: { min: 40, max: 80 },
    viability: "verified",
    viability_note:
      "Dell Wyse 5070 (Pentium Silver, 4-8GB RAM, mSATA SSD) is the standard cheap homelab box. ServeTheHome and r/homelab document Proxmox installs extensively.",
    category: "compute",
  },
  {
    slug: "pi-print-server",
    title: "Pi Zero W as a network print server",
    blurb: "CUPS on a Pi Zero, AirPrint to your old USB-only laser printer.",
    prompt:
      "Make my old USB-only laser printer accessible from phones and laptops on the network. Want AirPrint and Mopria support so it just works on iOS and Android.",
    difficulty: 2,
    est_cost_usd: { min: 15, max: 30 },
    viability: "verified",
    viability_note:
      "CUPS + Avahi on Raspberry Pi gives AirPrint + Bonjour discovery. Works for any USB printer with a Linux driver. Hundreds of writeups.",
    category: "network",
  },

  // ─── RETRO / GAMING ───────────────────────────────────────────────────
  {
    slug: "3ds-emulator",
    title: "Nintendo 3DS as a portable retro emulator",
    blurb: "Custom firmware (Luma3DS) opens up homebrew, emulators, region-free play.",
    prompt:
      "Convert a Nintendo 3DS or 2DS into a portable retro game emulator for GBA, NES, SNES. Need custom firmware that's safe to install and a clear walkthrough so I don't brick it.",
    difficulty: 2,
    est_cost_usd: { min: 60, max: 150 },
    viability: "verified",
    viability_note:
      "3ds.hacks.guide is the canonical walkthrough. Luma3DS is the standard custom firmware. Brick risk is real on bad installs — follow the guide step by step. The site's safety rule kicks in if brick-risk provenance is LLM-inferred.",
    category: "retro",
  },
  {
    slug: "gba-ezflash",
    title: "Game Boy Advance with EZ-Flash IV",
    blurb: "Original GBA + flashcart = every GBA, GB, and GBC game on a single SD card.",
    prompt:
      "Refurbish an original Game Boy Advance (or AGS-101 backlit) and load the entire library on a single SD card via a flashcart. Want a battery solution that's better than the original AAs.",
    difficulty: 2,
    est_cost_usd: { min: 100, max: 200 },
    viability: "verified",
    viability_note:
      "EZ-Flash Omega Definitive Edition is current; EZ-Flash IV still works. Kitsch-Bent and other vendors sell rechargeable mod kits. Modding GBA is a thriving hobby.",
    category: "retro",
  },
  {
    slug: "esp32-conference-badge",
    title: "ESP32 + e-paper as a conference badge",
    blurb: "LILYGO TTGO T5 + custom firmware = the badge everyone asks about at the conference.",
    prompt:
      "Programmable e-paper conference badge that I can update over Wi-Fi. Should display my name, current talk, and maybe a QR code linking to my GitHub. Battery-powered, week of standby.",
    difficulty: 2,
    est_cost_usd: { min: 20, max: 40 },
    viability: "verified",
    viability_note:
      "LILYGO TTGO T5 (ESP32 + 2.13 or 4.7\" e-paper) is the standard hacker-badge platform. ESPHome or stock Arduino IDE works. Battery-friendly thanks to e-paper.",
    category: "display",
  },
  {
    slug: "fire-tablet-kid-kiosk",
    title: "Amazon Fire HD 8 as a kid coding kiosk",
    blurb: "Fire OS + sideload + Tasker = locked-down learning tablet for $50.",
    prompt:
      "Locked-down coding/learning tablet for an 8-year-old. Want kid-safe content only, no app store wandering, simple UI. Cheap to replace if dropped. Bonus if I can sideload Tynker or Code.org.",
    difficulty: 2,
    est_cost_usd: { min: 30, max: 60 },
    viability: "iffy",
    viability_note:
      "Fire HD 8 supports sideloading via APKs. Amazon FreeTime is a built-in kid mode. Fully de-Amazoning requires unlocking the bootloader (newer Fire HD 8s ship with locked bootloaders — verify model year). LineageOS port exists for older units.",
    category: "compute",
  },
];

export const TEMPLATE_CATEGORIES: Record<Template["category"], string> = {
  display: "Display & Ambient",
  audio: "Audio",
  camera: "Cameras & Sensors",
  "smart-home": "Smart Home",
  robotics: "Robotics",
  network: "Networking",
  compute: "Compute & Homelab",
  retro: "Retro & Gaming",
};

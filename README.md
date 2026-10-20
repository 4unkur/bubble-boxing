# 🥊 Bubble Boxing

A boxing game for one kid. The MacBook camera watches the player, bubbles fly in around them at arm's length, and they punch them. The hands show up as 🥊 gloves on the TV.

## Run it

**Play online:** https://4unkur.github.io/bubble-boxing/ (Chrome, Edge or Safari; tap ▶ Play and allow the camera). Nothing to install, and the camera picture never leaves your device.

On the family Mac: double-click **`Bubble Boxing.app`** in this folder. You can drag it to the Dock. It opens the game in its own Chrome window, fullscreen, with no tabs.

`start.command` does the same in a normal Chrome tab (handy while changing the game). To rebuild the app: `tools/make-app.sh "Bubble Boxing" "🥊"`.
Click **▶ Play** and allow camera access.

Works fully offline. Everything the game needs is in this folder: the body-tracking files (MediaPipe, 25 MB) are in `vendor/`, and the local server and app builder are in `tools/`. It runs on port 8102.

## Living-room setup

Same as Bubble Pop: MacBook under the TV with the lid open, the kid **2–3 m away**. The whole upper body plus some room above the head must be in view, because bubbles also appear up high for uppercuts. The game says "Step back a little" when it can't see the hips.

## How to play

- **Pick a level** on the start screen by touching an animal with your hand for a moment (or press 1/2/3). The choice is remembered.
  - 🐢 ⭐ Easy: one big bubble at a time that waits a long time. Even a quick swat pops it. Good for the little one.
  - 🐇 ⭐⭐ Medium: up to 2 bubbles, a real punch is needed.
  - 🐆 ⭐⭐⭐ Hard: up to 3 smaller, quicker bubbles, plus 💣 bombs. Punching a bomb goes "Boom!" and costs 3 points (never below 0, and no game over). Touching a bomb gently is safe.
- **Raise both hands** above your head to start a round (or press Space). A round is 60 seconds.
- Bubbles fly in to the left, right or above the player, about one arm's length away. **Punch** them: the glove has to be moving fast. A slow touch only makes the bubble bounce with a "boing", and after a few of those the game says "Punch it fast!". The glove glows brighter when it's moving fast enough.
- A bubble nobody punches floats away after a few seconds. Nothing is lost.
- **Big golden ⭐ bubbles** need several punches (the white dots show how many are left) and are worth +5.
- Pops in quick succession build a 🔥 combo. Every 5 in a row gets a cheer.
- One player. If two kids stand in view, bubbles go around the one closest to the camera, but anyone's gloves can pop them.
- Everything on screen and every spoken phrase is in Russian (there is no English mode). Speech uses the device's built-in Russian voice; on Windows that needs the Russian language pack.
- Nobody loses: cheers every 15 points and confetti at the end.

## Keys

| Key | Action |
|---|---|
| F | Fullscreen |
| Space | Start / pause |
| 1 / 2 / 3 | Easy / medium / hard |
| M | Mute |
| D | Show the tracked skeleton and each glove's speed (debug) |

## Options (URL)

- `?time=90`: round length in seconds
- `?level=1|2|3`: start on easy / medium / hard

Example: `http://localhost:8102/?time=90&level=2`

More tuning is at the top of `game.js`. `LEVELS` sets per level how many bubbles at once, how long they wait (`stay`), their size, the big-bubble punches and the bomb chance, and `punch`, the glove speed needed to pop, in torso lengths per second. If punches don't register, press **D** and watch the numbers on the gloves while punching, then lower `punch`. `CONFIG.reach` sets how far from the shoulder bubbles appear.

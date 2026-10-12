# AI Receptionist Studio

A universal AI phone receptionist. Describe any business — opening hours, services, FAQs, tone of voice, who can take transfers — and the receptionist answers calls for it: it books appointments, takes messages, transfers callers to the right department and blocks spam, then logs every call with a transcript and summary.

Talk to it with your microphone (the browser's speech recognition and text-to-speech) or by typing. Built on [Claude](https://www.anthropic.com/claude) via the Anthropic API.

## Features

- **Any business, no code** — start from one of 8 templates (estate agency, dental clinic, restaurant, salon, law firm, trades, garage, gym) and edit: receptionist name, greeting, tone, services with their own prices and lengths, facts and FAQs, emergency instructions, extra rules, opening hours and departments.
- **Multilingual** — choose which languages it speaks (English, Ukrainian, Russian, Polish, Spanish and more); it replies in the caller's language, and the mic and voice follow the chosen call language.
- **Switchable abilities** — bookings, finding/cancelling/moving bookings, messages, transfers and spam blocking; optionally always collect an email and/or address. The AI only gets the tools that are switched on.
- **Booking rules enforced in code** — opening hours, per-service length (no overlaps), minimum notice, and how far ahead people can book. A caller can't talk it into breaking the business's rules.
- **Answer style & quality** — short / balanced / detailed replies, an optional "messages only when closed" mode, and fast / balanced / best quality (maps to Claude's effort level).
- **Good phone manner** — offers two or three times instead of reading a list, reads details back before booking, says dates naturally, gets "next Tuesday" right (a two-week calendar is supplied each call) and is honest that it's an AI if asked.
- **Dashboard** — live call screen with caller details and an action timeline, a week **Diary** with cancel, and **Activity** stats with messages, transfers and full call transcripts.

## Run it

Requires Node.js 22+ and an [Anthropic API key](https://console.anthropic.com/settings/keys).

```bash
npm install
cp .env.example .env     # then paste your key into .env
npm start                # http://localhost:3000
```

The dashboard opens with two example businesses (an estate agency and a dental clinic). Pick one, press **Start call**, and play the caller.

```bash
npm test                 # booking rules, validation, prompt and the full tool loop (with a fake model)
```

## How it works

| File | Role |
|------|------|
| `src/server.js` | Node HTTP server (no framework): JSON API + static dashboard. Listens on `127.0.0.1` only, validates every request. |
| `src/receptionist.js` | Builds the receptionist's instructions from the company settings and runs each caller turn: call Claude → run any tools → send results back → repeat until it speaks. |
| `src/tools.js` | The actions (`check_availability`, `book_appointment`, `take_message`, `transfer_call`, `end_call`) with strict schemas and the business rules. |
| `src/store.js` | JSON-file storage in `data/` (created on first run; atomic writes). |
| `public/` | The dashboard: call simulator with voice, setup form, activity view. |

Model: `claude-opus-5-5` at low effort for phone-call response times, with the system prompt cached across calls (the current date goes in a separate per-call message so the cache isn't broken) and server-side refusal fallback enabled. Conversation history is append-only.

## Next steps

- Connect a real phone number (e.g. Twilio Media Streams) in front of the same `handleCallerTurn` loop.
- Calendar sync (Google Calendar / Outlook) instead of the local booking list.
- Email or SMS notifications when a message is taken.

## License

MIT

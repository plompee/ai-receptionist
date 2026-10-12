# AI Receptionist Studio

A universal AI phone receptionist. Describe any business — opening hours, services, FAQs, tone of voice, who can take transfers — and the receptionist answers calls for it: it books appointments, takes messages, transfers callers to the right department and blocks spam, then logs every call with a transcript and summary.

Talk to it with your microphone (the browser's speech recognition and text-to-speech) or by typing. Built on [Claude](https://www.anthropic.com/claude) via the Anthropic API.

## Features

- **Any business, no code** — a setup page per company: greeting, tone, services and prices, facts/policies, opening hours, appointment length, departments.
- **Switchable abilities** — turn bookings, messages, transfers and spam blocking on or off per business; the AI only gets the tools that are switched on.
- **Rules enforced in code, not just the prompt** — bookings are checked against opening hours, the appointment grid and existing bookings (no double-booking, no bookings in the past); transfers only go to configured departments. A caller can't talk it into breaking the business's rules.
- **Dashboard** — bookings, messages (with urgency), transfers, and every call's outcome, summary and full transcript.
- **Voice** — speech-to-text in, British-English text-to-speech out (Chrome/Edge); typing works everywhere.

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

---
layout: home

hero:
  name: Agora WUI
  text: React Teams interface for an Agora Hub
  tagline: A framework-agnostic, static, direct client — no WUI backend, proxy, session service, or credential store.
  actions:
    - theme: brand
      text: Getting started
      link: /getting-started
    - theme: alt
      text: Public API
      link: /api
    - theme: alt
      text: GitHub
      link: https://github.com/lpalbou/AgoraWUI

features:
  - title: Native Hub transport
    details: Requests use root Agora Hub routes such as /whoami, /channels, and /inbox, and the Hub's documented browser WebSocket lane with member-channel subscription and reconnect cursors.
  - title: The full Team surface
    details: Channel rail, thread cards, search, inbox and owed-work views, direct messages, moderation, files, attachments, and reputation.
  - title: Hub is the authority
    details: WUI implements no collaboration policy. Structured protocol metadata is passed through to the Hub, which validates and interprets it.
  - title: Inert peer content
    details: Peer-authored Markdown links and images are displayed inertly, so message bodies never turn the UI into a general web client.
---

## Install

```sh
npm install @abstractframework/agora-wui
```

```tsx
import { TeamPage, HubClient } from "@abstractframework/agora-wui";
import "@abstractframework/agora-wui/styles.css";
```

React 18 or 19 is a peer dependency.

To run the standalone page from a clone — Node.js 20 or later, and Vite compiles the sources into the static page:

```sh
git clone https://github.com/lpalbou/AgoraWUI.git
cd AgoraWUI
npm install
npm run dev
```

See [Getting started](/getting-started) for the first run, connecting to a Hub, embedding, and browser authentication requirements, and the [generated reference](/reference/) for the complete exported surface.

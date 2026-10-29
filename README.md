# ClearLine

**AI line clearance for pharmaceutical manufacturing, powered by Meta SAM 3.1 and Muse Spark.**

Before a new batch starts on a packaging line, GMP requires a *line clearance*: proof that nothing from the
previous batch is left behind. No stray tablets, labels, vials or cartons. Today it's done by eye, typically
about an hour of operator time plus an hour of QA oversight, and a single missed tablet can mean a mix-up,
a quality notification and lost production.

ClearLine puts fixed cameras on the line and lets Meta's models watch every area:

1. Each camera learns what the line looks like **clean**.
2. When a camera sees a change, **SAM 3.1** finds and outlines every tablet, capsule, label, vial or carton in view.
3. **Muse Spark** checks each find against that area's checklist and decides whether it's a real leftover.
4. The dashboard shows live alerts, lists the spots no camera can see, and produces a clearance record for QA to review and sign.

> Built for the **Meta Global AI Developer Hackathon** (Oct 26 – Nov 4, 2026).
> Everything in this repository was created during the hackathon. Built with the help of AI coding assistants.

## Status

- [x] **Virtual plant**: a 16 x 12 m packaging room with an L-shaped line (feeder, conveyor with guide rails,
      labeler, corner turntable, checkweigher with reject bin, cartoner), operator workstations, a QA desk,
      packing table, trolley and staging rack, watched by 16 fixed cameras, built in Three.js
- [x] **Leftover simulator**: hides tablets, capsules, labels, vials and cartons in realistic spots and knows
      exactly which cameras can see each one (ground truth for scoring)
- [x] **Change detection** (stage 1): each camera keeps a clean reference and flags new regions. On 30 random
      scenarios it caught every visible leftover (99 of 99) with zero false alarms
- [x] **Multi-camera fusion**: the cameras are calibrated, so each change is located in the room. Several
      cameras seeing the same object give one alert with the location ("Under north rail (A)") and every view
- [x] **AI stages wired in** (stages 2-3): each change is cropped and enlarged from its clearest camera, SAM 3.1
      identifies what's there, and Muse Spark judges it against the area's checklist
- [x] **Control room**: camera grid, alerts, operator actions with automatic re-check, manual checks for
      measured blind spots, QA review and sign-off, and a printable clearance record
- [x] **Local API** that holds the Meta key server-side and enforces a dollar spending cap
- [x] **Phone cameras**: a phone joins the control room as a live camera with a join code. Its clean
      picture is learned over a few seconds, including how much each pixel flickers, so small items are
      caught without noise alarms; a bumped camera gives a warning instead of false alerts
- [ ] First run against the real Meta models (waiting for API credits)
- [ ] Automatic scoring over hundreds of random scenarios, end to end
- [ ] Phone camera tested on the physical mock line

## Run it

Requires Node.js 20 or newer.

```bash
npm install
npm run dev
```

To connect Meta's models, copy `.env.example` to `.env` and add your Meta Model API key.
`SPEND_LIMIT_USD` stops all calls to Meta's models once the estimated spend for the run reaches it ($2 by default).

Then open the address it prints. In the virtual plant:

- **Hide 3 leftovers** scatters items; **Show hidden items** marks them with red pins in the free view.
- Click a camera tile to look through that camera.
- **Open control room**, enter an operator name and start a clearance. Work through the findings
  (**Removed, re-check** makes the cameras confirm the spot is clean), tick the manual checks,
  submit for QA, and approve or reject. **Clearance record** shows the full, printable record.
- **Capture all cameras** grabs the full-size frames that get sent to the AI, with green boxes showing where
  the items really are.

### Adding a phone camera

```bash
npm run dev:phone
```

This serves ClearLine over HTTPS on your local network (phones only allow camera access on secure pages; the
certificate is self-signed, so each device asks you to trust it once). The control room shows the phone address
and a join code. On the phone, open the address, enter the code, prop the phone up facing the area, then press
**Set clean picture** on its tile while the area is clean.

Only phone picture uploads are accepted from the network. Everything else, including every call that spends
API credits, only answers the computer running ClearLine.

### Testing the AI path offline

`scripts/meta-stand-in.mjs` is a local stand-in for the Meta Model API. It checks requests have the documented
shape and answers in the documented formats with fixed, fake results, so the pipeline can be tested without
credits. The control room shows a red "TEST STAND-IN" warning whenever it is in use.

```bash
npm run stand-in
META_API_BASE=http://localhost:5199/v1 MODEL_API_KEY=test npx vite --port 5180
```

All product names, batch numbers and line layouts are fictional.

## License

MIT

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

- [x] **Virtual plant**: a simulated packaging room (feeder, conveyor with guide rails, labeler, reject bin,
      cartoner, packing table) with 7 fixed cameras, built in Three.js
- [x] **Leftover simulator**: hides tablets, capsules, labels, vials and cartons in realistic spots and knows
      exactly which cameras can see each one (ground truth for scoring)
- [ ] Detection pipeline: change detection → SAM 3.1 → Muse Spark
- [ ] Live dashboard, alerts and QA sign-off
- [ ] Automatic scoring over hundreds of random scenarios
- [ ] Real phone camera on a mock line

## Run it

Requires Node.js 20 or newer.

```bash
npm install
npm run dev
```

Then open the address it prints. In the virtual plant:

- **Hide 3 leftovers** scatters items; **Show hidden items** marks them with red pins in the free view.
- Click a camera tile to look through that camera.
- **Capture all cameras** grabs the full-size frames that get sent to the AI, with green boxes showing where
  the items really are.

All product names, batch numbers and line layouts are fictional.

## License

MIT

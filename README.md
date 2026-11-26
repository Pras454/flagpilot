# FlagPilot

Describe an A/B test in plain language; FlagPilot plans the flag, metric,
and rollout, shows the exact plan for human approval, then creates, starts,
and reports the experiment on Flagsmith — including the experiment-start
step Flagsmith's own MCP server cannot perform.

Status: live-verified on Flagsmith Cloud (27 Nov 2026). Gate 1 passed on a
free account: organisation `toggle-wars-demo` (42351), project
`toggle-wars-demo` (56691), environment `Development` (121261). The demo
experiment "Checkout button copy" (#786) is running with flag
`checkout_button` (#306271), variant "Get yours" (#37508), and metric
`purchase` (#821).

## Safety rules baked in

- No write reaches Flagsmith before a human approves the rendered plan
  (CLI: interactive confirm, or `--yes` after reviewing the plan).
- Dry-run is the default. Live execution reads current state first and
  reuses a matching running experiment instead of creating a duplicate;
  it only ensures missing pieces, then verifies the experiment is running.
- Variations without keys are rejected (Flagsmith records no exposure for
  them); allocations over 100% are rejected; event names keep their exact
  case (Flagsmith matching is case-sensitive).
- Live mode in this workspace calls the verified Flagsmith helper, which
  uses the stored credential. FlagPilot never sees or prints the
  credential, and readbacks never include environment keys.
- The results simulator is local and deterministic. It sends no Flagsmith
  events and its numbers are never presented as live evidence.

## Run the demo

```bash
npm test
node src/cli.js plan
node src/cli.js execute            # dry-run (default): records steps only
node src/cli.js status             # live read-only status via the helper
node src/cli.js execute --live --yes
node src/cli.js simulate --seed flagpilot-demo --users 300
node src/cli.js demo               # plan + dry-run + simulation
```

`execute --live --yes` first reads Flagsmith state. If the matching
experiment is already running, it reuses it and performs no duplicate
writes. If pieces are missing, it runs the helper's idempotent ensure
flow (warehouse → flag → metric → experiment → start) and then verifies
the experiment status by reading it back.

## Skrip demo singkat (Bahasa Indonesia)

Teks yang bisa diucapkan Bagus saat rekaman demo:

1. "Ini FlagPilot. Saya jelaskan tes A/B dengan bahasa biasa: tombol
   checkout, 'Buy now' lawan 'Get yours', suksesnya adalah pembelian."
2. "FlagPilot membuat rencana lengkapnya dulu. Belum ada perubahan apa
   pun sebelum saya setujui."
3. "Setelah saya setujui, FlagPilot memeriksa Flagsmith. Eksperimen yang
   sudah berjalan dipakai lagi, jadi tidak ada duplikat."
4. "Ini status live dari Flagsmith: warehouse aktif, flag dan metric
   ada, eksperimen berjalan."
5. "Untuk contoh laporan, simulator lokal menunjukkan perbandingan
   control dan variant. Ini simulasi lokal, bukan data live."
6. "Kesimpulannya: satu perintah untuk rencana, persetujuan manusia
   sebelum perubahan, lalu eksperimen berjalan dan terverifikasi."

Urutan perintah saat rekaman:

```bash
node src/cli.js plan
node src/cli.js execute
node src/cli.js status
node src/cli.js execute --live --yes
node src/cli.js simulate --seed flagpilot-demo --users 300
```

## Remaining manual steps

- Create the public GitHub repo (choice still pending) and push.
- Record/upload the demo video.
- Submit on WeMakeDevs before 29 Nov 2026 21:30 WIB.

MIT

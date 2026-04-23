import { useState, useEffect, useRef, useCallback } from "react";

// ─── Palette & konstanta ───────────────────────────────────────────────────
const DURATION = 15 * 60; // 15 menit dalam detik

const KEGIATAN = [
  "Sholat Subuh", "Sholat Dzuhur", "Sholat Ashar",
  "Sholat Maghrib", "Sholat Isya", "Tahajjud",
  "Kajian Kitab", "Tahfidz", "Muhadharah", "Piket"
];

// Simulasi data santri (500+ santri — sample 20 untuk demo)
const generateSantri = () => {
  const kamar = ["Al-Fatih", "Al-Kautsar", "Ar-Rahman", "Al-Ikhlas", "Az-Zahra"];
  const names = [
    "Ahmad Fauzi","Rizki Maulana","Bagas Saputra","Daffa Ardiansyah","Eko Prasetyo",
    "Faiz Nugraha","Ghozali Ramadan","Haikal Pratama","Ilham Zulkifli","Jafar Siddiq",
    "Siti Aisyah","Fatimah Zahra","Khadijah Nur","Maryam Salwa","Nisa Aulia",
    "Putri Rahayu","Qonita Syifa","Rania Husna","Sarah Nabila","Taqiyah Mufidah"
  ];
  return names.map((name, i) => ({
    id: `STR-${String(i + 1).padStart(4, "0")}`,
    nama: name,
    kamar: kamar[i % kamar.length],
    qr: `QR-${String(i + 1).padStart(4, "0")}`,
  }));
};

const SANTRI_DB = generateSantri();

// ─── Helpers ───────────────────────────────────────────────────────────────
const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
const now = () => new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
const todayStr = () => new Date().toLocaleDateString("id-ID", { weekday:"long", day:"numeric", month:"long", year:"numeric" });

// ─── Komponen utama ────────────────────────────────────────────────────────
export default function AbsensiPesantren() {
  const [screen, setScreen] = useState("home"); // home | setup | sesi | recap
  const [kegiatan, setKegiatan] = useState("");
  const [sesiId, setSesiId] = useState(null);
  const [timer, setTimer] = useState(DURATION);
  const [hadir, setHadir] = useState({}); // { santriId: waktu }
  const [scanInput, setScanInput] = useState("");
  const [lastScan, setLastScan] = useState(null); // {nama, status}
  const [flash, setFlash] = useState(null); // "ok" | "dup" | "err"
  const [logs, setLogs] = useState([]);
  const inputRef = useRef(null);
  const intervalRef = useRef(null);

  // ── Timer ──
  useEffect(() => {
    if (screen !== "sesi") return;
    intervalRef.current = setInterval(() => {
      setTimer(t => {
        if (t <= 1) { clearInterval(intervalRef.current); endSesi(); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, [screen]);

  // ── Auto-focus input scan ──
  useEffect(() => {
    if (screen === "sesi") setTimeout(() => inputRef.current?.focus(), 100);
  }, [screen]);

  const startSesi = () => {
    if (!kegiatan) return;
    setSesiId(`SESI-${Date.now()}`);
    setHadir({});
    setLogs([]);
    setTimer(DURATION);
    setLastScan(null);
    setScreen("sesi");
  };

  const endSesi = useCallback(() => {
    clearInterval(intervalRef.current);
    setScreen("recap");
  }, []);

  const handleScan = (e) => {
    if (e.key !== "Enter") return;
    const val = scanInput.trim().toUpperCase();
    setScanInput("");

    const santri = SANTRI_DB.find(s => s.qr === val || s.id === val);
    if (!santri) {
      setFlash("err");
      setLastScan({ nama: val, status: "Tidak Ditemukan ❌" });
      setTimeout(() => setFlash(null), 800);
      return;
    }
    if (hadir[santri.id]) {
      setFlash("dup");
      setLastScan({ nama: santri.nama, status: "Sudah Absen ⚠️" });
      setTimeout(() => setFlash(null), 800);
      return;
    }
    const waktu = now();
    setHadir(prev => ({ ...prev, [santri.id]: waktu }));
    setLogs(prev => [{ ...santri, waktu }, ...prev]);
    setFlash("ok");
    setLastScan({ nama: santri.nama, status: `Hadir ✅ — ${waktu}` });
    setTimeout(() => setFlash(null), 800);
  };

  // Simulasi scan QR acak (untuk demo)
  const simulateScan = () => {
    const belum = SANTRI_DB.filter(s => !hadir[s.id]);
    if (!belum.length) return;
    const pick = belum[Math.floor(Math.random() * belum.length)];
    const waktu = now();
    setHadir(prev => ({ ...prev, [pick.id]: waktu }));
    setLogs(prev => [{ ...pick, waktu }, ...prev]);
    setFlash("ok");
    setLastScan({ nama: pick.nama, status: `Hadir ✅ — ${waktu}` });
    setTimeout(() => setFlash(null), 800);
  };

  const totalHadir = Object.keys(hadir).length;
  const totalSantri = SANTRI_DB.length;
  const persen = Math.round((totalHadir / totalSantri) * 100);
  const alpha = SANTRI_DB.filter(s => !hadir[s.id]);

  // ── Rekap WhatsApp ──
  const generateWA = () => {
    const lines = [
      `🕌 *REKAP ABSENSI PESANTREN*`,
      `📅 ${todayStr()}`,
      `📌 Kegiatan: *${kegiatan}*`,
      ``,
      `✅ Hadir      : ${totalHadir} santri`,
      `❌ Tidak Hadir: ${alpha.length} santri`,
      `📊 Persentase : ${persen}%`,
      ``,
      `*Daftar Tidak Hadir:*`,
      ...alpha.map(s => `• ${s.nama} (${s.kamar})`),
      ``,
      `_Generated otomatis — Sistem Absensi Pesantren_`
    ].join("\n");
    const encoded = encodeURIComponent(lines);
    window.open(`https://wa.me/?text=${encoded}`, "_blank");
  };

  // ── Rekap Google Sheets (CSV download) ──
  const downloadCSV = () => {
    const rows = [["ID", "Nama", "Kamar", "Status", "Waktu Hadir"]];
    SANTRI_DB.forEach(s => {
      rows.push([s.id, s.nama, s.kamar, hadir[s.id] ? "Hadir" : "Alpha", hadir[s.id] || "-"]);
    });
    const csv = rows.map(r => r.join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `absensi-${kegiatan.replace(/ /g, "_")}-${Date.now()}.csv`;
    a.click();
  };

  const timerPct = (timer / DURATION) * 100;
  const timerColor = timer > 300 ? "#4ade80" : timer > 120 ? "#facc15" : "#f87171";

  // ══════════════════════════════════════════════════════════════════════════
  return (
    <div style={{
      minHeight: "100vh",
      background: "linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f2027 100%)",
      fontFamily: "'Segoe UI', system-ui, sans-serif",
      color: "#e2e8f0",
      padding: "0",
      overflowX: "hidden",
    }}>
      {/* ── Header ── */}
      <header style={{
        background: "rgba(255,255,255,0.03)",
        borderBottom: "1px solid rgba(255,255,255,0.08)",
        padding: "16px 24px",
        display: "flex",
        alignItems: "center",
        gap: "12px",
        backdropFilter: "blur(12px)",
        position: "sticky", top: 0, zIndex: 100,
      }}>
        <div style={{ fontSize: 28 }}>🕌</div>
        <div>
          <div style={{ fontWeight: 700, fontSize: 16, color: "#f8fafc", letterSpacing: "0.5px" }}>
            Sistem Absensi Pesantren
          </div>
          <div style={{ fontSize: 12, color: "#64748b" }}>{todayStr()}</div>
        </div>
        {screen !== "home" && (
          <button onClick={() => setScreen("home")} style={{
            marginLeft: "auto", background: "rgba(255,255,255,0.06)",
            border: "1px solid rgba(255,255,255,0.1)", borderRadius: 8,
            color: "#94a3b8", padding: "6px 14px", cursor: "pointer", fontSize: 13,
          }}>← Beranda</button>
        )}
      </header>

      <div style={{ maxWidth: 680, margin: "0 auto", padding: "24px 16px" }}>

        {/* ══ HOME ══ */}
        {screen === "home" && (
          <div>
            <div style={{ textAlign: "center", marginBottom: 40, paddingTop: 20 }}>
              <div style={{ fontSize: 64, marginBottom: 12 }}>📋</div>
              <h1 style={{ fontSize: 26, fontWeight: 800, color: "#f8fafc", margin: "0 0 8px" }}>
                Absensi Digital Pesantren
              </h1>
              <p style={{ color: "#64748b", fontSize: 14, margin: 0 }}>
                Sistem absensi berbasis QR Code — cepat, akurat, otomatis
              </p>
            </div>

            {/* Stats */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 32 }}>
              {[
                { icon: "👥", label: "Total Santri", val: `${totalSantri}+` },
                { icon: "⚡", label: "Durasi Sesi", val: "15 Menit" },
                { icon: "📤", label: "Rekap", val: "WA + Sheets" },
              ].map((s, i) => (
                <div key={i} style={{
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 14, padding: "18px 12px", textAlign: "center",
                }}>
                  <div style={{ fontSize: 24, marginBottom: 6 }}>{s.icon}</div>
                  <div style={{ fontSize: 18, fontWeight: 700, color: "#f8fafc" }}>{s.val}</div>
                  <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{s.label}</div>
                </div>
              ))}
            </div>

            <button onClick={() => setScreen("setup")} style={{
              width: "100%", padding: "18px",
              background: "linear-gradient(135deg, #22c55e, #16a34a)",
              border: "none", borderRadius: 14, color: "#fff",
              fontSize: 17, fontWeight: 700, cursor: "pointer",
              boxShadow: "0 8px 32px rgba(34,197,94,0.3)",
              letterSpacing: "0.5px",
            }}>
              🚀 Mulai Sesi Absensi
            </button>

            <div style={{ marginTop: 16, padding: 16, background: "rgba(59,130,246,0.08)",
              border: "1px solid rgba(59,130,246,0.2)", borderRadius: 12 }}>
              <div style={{ fontSize: 13, color: "#93c5fd" }}>
                💡 <strong>Cara pakai:</strong> Pilih kegiatan → Santri scan QR → Rekap otomatis terkirim ke WhatsApp & Google Sheets setelah 15 menit
              </div>
            </div>
          </div>
        )}

        {/* ══ SETUP ══ */}
        {screen === "setup" && (
          <div>
            <h2 style={{ fontSize: 20, fontWeight: 700, marginBottom: 24, color: "#f8fafc" }}>
              ⚙️ Buka Sesi Absensi
            </h2>
            <label style={{ display: "block", marginBottom: 8, color: "#94a3b8", fontSize: 14 }}>
              Pilih Kegiatan
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 28 }}>
              {KEGIATAN.map(k => (
                <button key={k} onClick={() => setKegiatan(k)} style={{
                  padding: "12px 16px", borderRadius: 10, cursor: "pointer", fontSize: 14,
                  background: kegiatan === k ? "linear-gradient(135deg, #22c55e, #16a34a)" : "rgba(255,255,255,0.04)",
                  border: kegiatan === k ? "2px solid #22c55e" : "1px solid rgba(255,255,255,0.08)",
                  color: kegiatan === k ? "#fff" : "#cbd5e1",
                  fontWeight: kegiatan === k ? 700 : 400,
                  transition: "all 0.2s",
                }}>
                  {k}
                </button>
              ))}
            </div>

            {/* Kegiatan custom */}
            <label style={{ display: "block", marginBottom: 8, color: "#94a3b8", fontSize: 14 }}>
              Atau ketik kegiatan lain
            </label>
            <input
              type="text"
              placeholder="Contoh: Kerja Bakti, Ziarah, dll."
              value={KEGIATAN.includes(kegiatan) ? "" : kegiatan}
              onChange={e => setKegiatan(e.target.value)}
              style={{
                width: "100%", padding: "12px 16px", borderRadius: 10,
                background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.1)",
                color: "#f8fafc", fontSize: 14, marginBottom: 28, boxSizing: "border-box",
              }}
            />

            <button onClick={startSesi} disabled={!kegiatan} style={{
              width: "100%", padding: "16px",
              background: kegiatan ? "linear-gradient(135deg, #22c55e, #16a34a)" : "rgba(255,255,255,0.05)",
              border: "none", borderRadius: 12, color: kegiatan ? "#fff" : "#475569",
              fontSize: 16, fontWeight: 700, cursor: kegiatan ? "pointer" : "not-allowed",
            }}>
              ▶ Mulai Absensi — {kegiatan || "Pilih kegiatan dulu"}
            </button>
          </div>
        )}

        {/* ══ SESI ══ */}
        {screen === "sesi" && (
          <div>
            {/* Flash overlay */}
            {flash && (
              <div style={{
                position: "fixed", inset: 0, zIndex: 200, pointerEvents: "none",
                background: flash === "ok" ? "rgba(34,197,94,0.15)" : flash === "dup" ? "rgba(250,204,21,0.15)" : "rgba(248,113,113,0.15)",
                transition: "background 0.2s",
              }} />
            )}

            {/* Timer besar */}
            <div style={{ textAlign: "center", marginBottom: 24 }}>
              <div style={{ fontSize: 12, color: "#64748b", marginBottom: 6, letterSpacing: 2, textTransform: "uppercase" }}>
                {kegiatan}
              </div>
              {/* Ring timer */}
              <div style={{ position: "relative", display: "inline-block", marginBottom: 8 }}>
                <svg width="140" height="140" style={{ transform: "rotate(-90deg)" }}>
                  <circle cx="70" cy="70" r="62" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="8"/>
                  <circle cx="70" cy="70" r="62" fill="none"
                    stroke={timerColor} strokeWidth="8"
                    strokeDasharray={`${2 * Math.PI * 62}`}
                    strokeDashoffset={`${2 * Math.PI * 62 * (1 - timerPct / 100)}`}
                    strokeLinecap="round"
                    style={{ transition: "stroke-dashoffset 1s linear, stroke 0.5s" }}
                  />
                </svg>
                <div style={{
                  position: "absolute", inset: 0, display: "flex",
                  flexDirection: "column", alignItems: "center", justifyContent: "center",
                }}>
                  <div style={{ fontSize: 30, fontWeight: 800, color: timerColor, fontVariantNumeric: "tabular-nums" }}>
                    {fmt(timer)}
                  </div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>tersisa</div>
                </div>
              </div>
            </div>

            {/* Counter hadir */}
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 20
            }}>
              {[
                { val: totalHadir, label: "Hadir", color: "#4ade80" },
                { val: alpha.length, label: "Belum", color: "#f87171" },
                { val: `${persen}%`, label: "Kehadiran", color: "#60a5fa" },
              ].map((s, i) => (
                <div key={i} style={{
                  background: "rgba(255,255,255,0.04)", borderRadius: 12,
                  padding: "12px 8px", textAlign: "center",
                  border: "1px solid rgba(255,255,255,0.06)",
                }}>
                  <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.val}</div>
                  <div style={{ fontSize: 11, color: "#64748b" }}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Scan area */}
            <div style={{
              background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 14, padding: 16, marginBottom: 16,
            }}>
              <div style={{ fontSize: 13, color: "#94a3b8", marginBottom: 8 }}>
                📷 Scan QR Santri (arahkan ke kamera atau masukkan kode)
              </div>
              <input
                ref={inputRef}
                type="text"
                value={scanInput}
                onChange={e => setScanInput(e.target.value)}
                onKeyDown={handleScan}
                placeholder="QR-0001 atau STR-0001 lalu Enter..."
                style={{
                  width: "100%", padding: "12px 14px", borderRadius: 10,
                  background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.12)",
                  color: "#f8fafc", fontSize: 14, boxSizing: "border-box",
                }}
              />

              {/* Feedback scan terakhir */}
              {lastScan && (
                <div style={{
                  marginTop: 10, padding: "10px 14px", borderRadius: 8,
                  background: flash === "ok" ? "rgba(34,197,94,0.1)" : flash === "dup" ? "rgba(250,204,21,0.1)" : "rgba(248,113,113,0.1)",
                  border: `1px solid ${flash === "ok" ? "rgba(34,197,94,0.3)" : flash === "dup" ? "rgba(250,204,21,0.3)" : "rgba(248,113,113,0.3)"}`,
                  fontSize: 13,
                }}>
                  <strong>{lastScan.nama}</strong> — {lastScan.status}
                </div>
              )}

              {/* Tombol simulasi */}
              <button onClick={simulateScan} style={{
                marginTop: 10, width: "100%", padding: "10px",
                background: "rgba(99,102,241,0.15)", border: "1px solid rgba(99,102,241,0.3)",
                borderRadius: 8, color: "#a5b4fc", fontSize: 13, cursor: "pointer",
              }}>
                🎲 Simulasi Scan Acak (Demo)
              </button>
            </div>

            {/* Log terbaru */}
            {logs.length > 0 && (
              <div style={{
                background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 12, overflow: "hidden", marginBottom: 16,
              }}>
                <div style={{ padding: "10px 14px", borderBottom: "1px solid rgba(255,255,255,0.06)",
                  fontSize: 12, color: "#64748b", letterSpacing: 1, textTransform: "uppercase" }}>
                  Log Absensi Terbaru
                </div>
                <div style={{ maxHeight: 200, overflowY: "auto" }}>
                  {logs.slice(0, 10).map((l, i) => (
                    <div key={i} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "9px 14px", borderBottom: "1px solid rgba(255,255,255,0.04)",
                      fontSize: 13,
                    }}>
                      <div>
                        <span style={{ color: "#f8fafc", fontWeight: 600 }}>{l.nama}</span>
                        <span style={{ color: "#64748b", marginLeft: 8 }}>{l.kamar}</span>
                      </div>
                      <span style={{ color: "#4ade80", fontSize: 12 }}>✅ {l.waktu}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button onClick={endSesi} style={{
              width: "100%", padding: "14px",
              background: "rgba(239,68,68,0.15)", border: "1px solid rgba(239,68,68,0.3)",
              borderRadius: 12, color: "#f87171", fontSize: 15, fontWeight: 700, cursor: "pointer",
            }}>
              ⏹ Tutup Sesi & Lihat Rekap
            </button>
          </div>
        )}

        {/* ══ RECAP ══ */}
        {screen === "recap" && (
          <div>
            <div style={{ textAlign: "center", marginBottom: 28 }}>
              <div style={{ fontSize: 48, marginBottom: 8 }}>📊</div>
              <h2 style={{ fontSize: 22, fontWeight: 800, color: "#f8fafc", margin: "0 0 4px" }}>
                Rekap Absensi
              </h2>
              <div style={{ color: "#64748b", fontSize: 13 }}>{kegiatan} — {todayStr()}</div>
            </div>

            {/* Ringkasan besar */}
            <div style={{
              background: "linear-gradient(135deg, rgba(34,197,94,0.1), rgba(16,185,129,0.05))",
              border: "1px solid rgba(34,197,94,0.2)", borderRadius: 16, padding: 20, marginBottom: 20,
            }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
                {[
                  { label: "Total Santri", val: totalSantri, color: "#f8fafc" },
                  { label: "Hadir", val: totalHadir, color: "#4ade80" },
                  { label: "Tidak Hadir", val: alpha.length, color: "#f87171" },
                  { label: "Persentase", val: `${persen}%`, color: "#60a5fa" },
                ].map((s, i) => (
                  <div key={i}>
                    <div style={{ fontSize: 28, fontWeight: 800, color: s.color }}>{s.val}</div>
                    <div style={{ fontSize: 12, color: "#64748b" }}>{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Progress bar */}
              <div style={{ marginTop: 16 }}>
                <div style={{ height: 8, background: "rgba(255,255,255,0.08)", borderRadius: 4, overflow: "hidden" }}>
                  <div style={{
                    height: "100%", borderRadius: 4,
                    background: "linear-gradient(90deg, #22c55e, #4ade80)",
                    width: `${persen}%`, transition: "width 1s ease",
                  }} />
                </div>
                <div style={{ fontSize: 11, color: "#64748b", marginTop: 4, textAlign: "right" }}>
                  {persen}% kehadiran
                </div>
              </div>
            </div>

            {/* Per kamar */}
            <div style={{
              background: "rgba(255,255,255,0.03)", border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 14, marginBottom: 20, overflow: "hidden",
            }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,0.06)",
                fontSize: 13, fontWeight: 600, color: "#94a3b8" }}>
                📊 Rekap Per Kamar
              </div>
              {["Al-Fatih","Al-Kautsar","Ar-Rahman","Al-Ikhlas","Az-Zahra"].map(kamar => {
                const total = SANTRI_DB.filter(s => s.kamar === kamar).length;
                const h = SANTRI_DB.filter(s => s.kamar === kamar && hadir[s.id]).length;
                const p = Math.round((h / total) * 100);
                return (
                  <div key={kamar} style={{
                    padding: "10px 16px", borderBottom: "1px solid rgba(255,255,255,0.04)",
                    display: "flex", alignItems: "center", gap: 12,
                  }}>
                    <div style={{ width: 90, fontSize: 13, color: "#cbd5e1" }}>{kamar}</div>
                    <div style={{ flex: 1, height: 6, background: "rgba(255,255,255,0.06)", borderRadius: 3, overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${p}%`, background: p >= 80 ? "#4ade80" : p >= 60 ? "#facc15" : "#f87171", borderRadius: 3 }} />
                    </div>
                    <div style={{ fontSize: 12, color: "#64748b", minWidth: 60, textAlign: "right" }}>
                      {h}/{total} ({p}%)
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Daftar tidak hadir */}
            {alpha.length > 0 && (
              <div style={{
                background: "rgba(248,113,113,0.05)", border: "1px solid rgba(248,113,113,0.15)",
                borderRadius: 14, marginBottom: 24, overflow: "hidden",
              }}>
                <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(248,113,113,0.1)",
                  fontSize: 13, fontWeight: 600, color: "#fca5a5" }}>
                  ❌ Tidak Hadir ({alpha.length} santri)
                </div>
                <div style={{ maxHeight: 180, overflowY: "auto" }}>
                  {alpha.map((s, i) => (
                    <div key={i} style={{
                      padding: "8px 16px", borderBottom: "1px solid rgba(255,255,255,0.03)",
                      display: "flex", justifyContent: "space-between", fontSize: 13,
                    }}>
                      <span style={{ color: "#f8fafc" }}>{s.nama}</span>
                      <span style={{ color: "#64748b" }}>{s.kamar}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Tombol kirim */}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
              <button onClick={generateWA} style={{
                padding: "14px", borderRadius: 12, cursor: "pointer",
                background: "linear-gradient(135deg, #25D366, #128C7E)",
                border: "none", color: "#fff", fontSize: 14, fontWeight: 700,
                boxShadow: "0 4px 16px rgba(37,211,102,0.3)",
              }}>
                📲 Kirim ke WhatsApp
              </button>
              <button onClick={downloadCSV} style={{
                padding: "14px", borderRadius: 12, cursor: "pointer",
                background: "linear-gradient(135deg, #34a853, #0f9d58)",
                border: "none", color: "#fff", fontSize: 14, fontWeight: 700,
                boxShadow: "0 4px 16px rgba(52,168,83,0.3)",
              }}>
                📊 Export Google Sheets
              </button>
            </div>

            <button onClick={() => { setScreen("home"); setKegiatan(""); }} style={{
              width: "100%", padding: "12px",
              background: "rgba(255,255,255,0.04)", border: "1px solid rgba(255,255,255,0.08)",
              borderRadius: 12, color: "#94a3b8", fontSize: 14, cursor: "pointer",
            }}>
              🔄 Buat Sesi Baru
            </button>
          </div>
        )}

      </div>
    </div>
  );
}

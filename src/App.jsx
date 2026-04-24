import { useState, useEffect, useRef, useCallback } from "react";

const DURATION = 15 * 60;
const KEGIATAN = [
  "Sholat Subuh", "Sholat Dzuhur", "Sholat Ashar",
  "Sholat Maghrib", "Sholat Isya", "Tahajjud",
  "Kajian Kitab", "Tahfidz", "Muhadharah", "Piket"
];

const SHEETS_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRHyGfi-heXx4sC43HGtLFeWa9ahh-fh1eFPD6k5m-QD2b5M_mWQiSl-bJLkD0cx0MCpJ7mPy5uF8EB/pub?gid=0&single=true&output=csv";

const parseCSV = (text) => {
  const lines = text.trim().split("
");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().replace(/
/g,"").toLowerCase());
  return lines.slice(1).map(line => {
    const vals = line.split(",").map(v => v.trim().replace(/
/g,""));
    const obj = {};
    headers.forEach((h, i) => obj[h] = vals[i] || "");
    return {
      id: obj.id || obj["id santri"] || `STR-${Math.random().toString(36).slice(2,7)}`,
      nama: obj.nama || obj["nama santri"] || obj["name"] || "Tanpa Nama",
      kamar: obj.kamar || obj["kamar/kelas"] || obj["kelas"] || "-",
      qr: obj.qr_code || obj["qr"] || obj["kode qr"] || obj.id || "",
    };
  }).filter(s => s.nama && s.nama !== "Tanpa Nama");
};
const STORAGE_KEY = "absensi_pesantren_rekap";

const loadRekap = () => {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
};

const saveRekap = (data) => {
  try { sessionStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
};

const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
const nowTime = () => new Date().toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit" });
const todayStr = () => new Date().toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
const thisYear = () => new Date().getFullYear();

export default function AbsensiPesantren() {
  const [screen, setScreen] = useState("home");
  const [kegiatan, setKegiatan] = useState("");
  const [timer, setTimer] = useState(DURATION);
  const [hadir, setHadir] = useState({});
  const [scanInput, setScanInput] = useState("");
  const [lastScan, setLastScan] = useState(null);
  const [flash, setFlash] = useState(null);
  const [logs, setLogs] = useState([]);
  const [rekapTahunan, setRekapTahunan] = useState(loadRekap);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterKamar, setFilterKamar] = useState("Semua");
  const [filterKegiatan, setFilterKegiatan] = useState("Semua");
  const [selectedSantri, setSelectedSantri] = useState(null);
  const [sortBy, setSortBy] = useState("nama");
  const [savedNotif, setSavedNotif] = useState(false);
  const [santriDB, setSantriDB] = useState([]);
  const [dbStatus, setDbStatus] = useState("loading"); // loading | ok | error
  const inputRef = useRef(null);
  const intervalRef = useRef(null);

  // Fetch data santri dari Google Sheets saat pertama load
  useEffect(() => {
    setDbStatus("loading");
    fetch(SHEETS_CSV_URL)
      .then(r => r.text())
      .then(text => {
        const parsed = parseCSV(text);
        if (parsed.length === 0) { setDbStatus("error"); return; }
        setSantriDB(parsed);
        setDbStatus("ok");
      })
      .catch(() => setDbStatus("error"));
  }, []);

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

  useEffect(() => {
    if (screen === "sesi") setTimeout(() => inputRef.current?.focus(), 100);
  }, [screen]);

  useEffect(() => { saveRekap(rekapTahunan); }, [rekapTahunan]);

  const startSesi = () => {
    if (!kegiatan) return;
    setHadir({}); setLogs([]); setTimer(DURATION); setLastScan(null);
    setScreen("sesi");
  };

  const endSesi = useCallback(() => {
    clearInterval(intervalRef.current);
    setScreen("recap");
  }, []);

  const simpanKeRekap = (hadirData) => {
    const tahun = thisYear();
    const tanggal = new Date().toLocaleDateString("id-ID");
    setRekapTahunan(prev => {
      const updated = { ...prev };
      santriDB.forEach(s => {
        if (!updated[s.id]) updated[s.id] = {};
        if (!updated[s.id][tahun]) updated[s.id][tahun] = {};
        if (!updated[s.id][tahun][kegiatan]) updated[s.id][tahun][kegiatan] = { hadir: 0, alpha: 0, riwayat: [] };
        const status = hadirData[s.id] ? "hadir" : "alpha";
        updated[s.id][tahun][kegiatan][status] += 1;
        updated[s.id][tahun][kegiatan].riwayat.push({ tanggal, status, waktu: hadirData[s.id] || null });
      });
      return updated;
    });
    setSavedNotif(true);
    setTimeout(() => setSavedNotif(false), 2500);
  };

  const handleScan = (e) => {
    if (e.key !== "Enter") return;
    const val = scanInput.trim().toUpperCase();
    setScanInput("");
    const santri = santriDB.find(s => s.qr === val || s.id === val);
    if (!santri) {
      setFlash("err"); setLastScan({ nama: val, status: "Tidak Ditemukan ❌" });
      setTimeout(() => setFlash(null), 800); return;
    }
    if (hadir[santri.id]) {
      setFlash("dup"); setLastScan({ nama: santri.nama, status: "Sudah Absen ⚠️" });
      setTimeout(() => setFlash(null), 800); return;
    }
    const waktu = nowTime();
    setHadir(prev => ({ ...prev, [santri.id]: waktu }));
    setLogs(prev => [{ ...santri, waktu }, ...prev]);
    setFlash("ok"); setLastScan({ nama: santri.nama, status: `Hadir ✅ — ${waktu}` });
    setTimeout(() => setFlash(null), 800);
  };

  const simulateScan = () => {
    const belum = santriDB.filter(s => !hadir[s.id]);
    if (!belum.length) return;
    const pick = belum[Math.floor(Math.random() * belum.length)];
    const waktu = nowTime();
    setHadir(prev => ({ ...prev, [pick.id]: waktu }));
    setLogs(prev => [{ ...pick, waktu }, ...prev]);
    setFlash("ok"); setLastScan({ nama: pick.nama, status: `Hadir ✅ — ${waktu}` });
    setTimeout(() => setFlash(null), 800);
  };

  const totalHadir = Object.keys(hadir).length;
  const totalSantri = santriDB.length;
  const persen = Math.round((totalHadir / totalSantri) * 100);
  const alpha = santriDB.filter(s => !hadir[s.id]);
  const timerPct = (timer / DURATION) * 100;
  const timerColor = timer > 300 ? "#4ade80" : timer > 120 ? "#facc15" : "#f87171";

  const generateWA = () => {
    const lines = [
      `🕌 *REKAP ABSENSI PESANTREN*`, `📅 ${todayStr()}`, `📌 Kegiatan: *${kegiatan}*`, ``,
      `✅ Hadir      : ${totalHadir} santri`, `❌ Tidak Hadir: ${alpha.length} santri`,
      `📊 Persentase : ${persen}%`, ``, `*Daftar Tidak Hadir:*`,
      ...alpha.map(s => `• ${s.nama} (${s.kamar})`), ``,
      `_Generated otomatis — Sistem Absensi Pesantren_`
    ].join("\n");
    window.open(`https://wa.me/?text=${encodeURIComponent(lines)}`, "_blank");
  };

  const downloadCSV = () => {
    const rows = [["ID","Nama","Kamar","Status","Waktu Hadir","Kegiatan","Tanggal"]];
    santriDB.forEach(s => rows.push([s.id,s.nama,s.kamar,hadir[s.id]?"Hadir":"Alpha",hadir[s.id]||"-",kegiatan,new Date().toLocaleDateString("id-ID")]));
    const blob = new Blob([rows.map(r=>r.join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `absensi-${kegiatan.replace(/ /g,"_")}-${Date.now()}.csv`; a.click();
  };

  const getStatSantri = (santriId, tahun = thisYear(), kgFilter = "Semua") => {
    const data = rekapTahunan[santriId]?.[tahun] || {};
    let totalH = 0, totalA = 0; const perKegiatan = {};
    Object.entries(data).forEach(([kg, val]) => {
      if (kgFilter !== "Semua" && kg !== kgFilter) return;
      totalH += val.hadir; totalA += val.alpha;
      perKegiatan[kg] = { hadir: val.hadir, alpha: val.alpha, riwayat: val.riwayat };
    });
    const total = totalH + totalA;
    return { totalH, totalA, total, persen: total > 0 ? Math.round((totalH / total) * 100) : 0, perKegiatan };
  };

  const downloadCSVTahunan = () => {
    const tahun = thisYear();
    const rows = [["ID","Nama","Kamar","Kegiatan","Total Sesi","Hadir","Alpha","Persentase"]];
    santriDB.forEach(s => {
      const data = rekapTahunan[s.id]?.[tahun] || {};
      Object.entries(data).forEach(([kg, val]) => {
        const tot = val.hadir + val.alpha;
        rows.push([s.id,s.nama,s.kamar,kg,tot,val.hadir,val.alpha,`${tot>0?Math.round(val.hadir/tot*100):0}%`]);
      });
      if (!Object.keys(data).length) rows.push([s.id,s.nama,s.kamar,"-",0,0,0,"0%"]);
    });
    const blob = new Blob([rows.map(r=>r.join(",")).join("\n")], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob);
    a.download = `rekap-tahunan-${tahun}.csv`; a.click();
  };

  const kamarList = ["Semua", ...new Set(santriDB.map(s => s.kamar))];
  const kegiatanList = ["Semua", ...KEGIATAN];
  const santriFiltered = santriDB
    .filter(s => filterKamar === "Semua" || s.kamar === filterKamar)
    .filter(s => searchQuery === "" || s.nama.toLowerCase().includes(searchQuery.toLowerCase()) || s.id.toLowerCase().includes(searchQuery.toLowerCase()))
    .map(s => ({ ...s, stat: getStatSantri(s.id, thisYear(), filterKegiatan) }))
    .sort((a, b) => {
      if (sortBy === "hadir") return b.stat.totalH - a.stat.totalH;
      if (sortBy === "alpha") return b.stat.totalA - a.stat.totalA;
      if (sortBy === "persen") return b.stat.persen - a.stat.persen;
      return a.nama.localeCompare(b.nama);
    });

  const S = { minHeight:"100vh", background:"linear-gradient(135deg,#0f172a 0%,#1e293b 50%,#0f2027 100%)", fontFamily:"'Segoe UI',system-ui,sans-serif", color:"#e2e8f0" };
  const card = { background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:12 };

  return (
    <div style={S}>
      {savedNotif && (
        <div style={{ position:"fixed", top:70, left:"50%", transform:"translateX(-50%)", zIndex:300,
          background:"linear-gradient(135deg,#22c55e,#16a34a)", color:"#fff", padding:"10px 24px",
          borderRadius:30, fontSize:13, fontWeight:700, boxShadow:"0 4px 20px rgba(34,197,94,0.4)" }}>
          ✅ Berhasil disimpan ke Rekap Tahunan!
        </div>
      )}

      <header style={{ background:"rgba(255,255,255,0.03)", borderBottom:"1px solid rgba(255,255,255,0.08)",
        padding:"13px 18px", display:"flex", alignItems:"center", gap:10,
        position:"sticky", top:0, zIndex:100, backdropFilter:"blur(12px)" }}>
        <div style={{ fontSize:24 }}>🕌</div>
        <div style={{ flex:1 }}>
          <div style={{ fontWeight:700, fontSize:14, color:"#f8fafc" }}>Sistem Absensi Pesantren</div>
          <div style={{ fontSize:10, color:"#64748b" }}>{todayStr()}</div>
        </div>
        {screen !== "home" && (
          <button onClick={() => { setScreen("home"); setSelectedSantri(null); }} style={{
            background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)",
            borderRadius:8, color:"#94a3b8", padding:"5px 11px", cursor:"pointer", fontSize:11 }}>← Beranda</button>
        )}
      </header>

      <div style={{ maxWidth:680, margin:"0 auto", padding:"18px 13px" }}>

        {/* HOME */}
        {screen === "home" && (
          <div>
            <div style={{ textAlign:"center", marginBottom:28, paddingTop:14 }}>
              <div style={{ fontSize:52, marginBottom:8 }}>📋</div>
              <h1 style={{ fontSize:22, fontWeight:800, color:"#f8fafc", margin:"0 0 5px" }}>Absensi Digital Pesantren</h1>
              <p style={{ color:"#64748b", fontSize:12, margin:0 }}>Sistem absensi QR Code — cepat, akurat, otomatis</p>
            </div>

            {/* Status koneksi Google Sheets */}
            {dbStatus === "loading" && (
              <div style={{ padding:"10px 14px", background:"rgba(250,204,21,0.08)", border:"1px solid rgba(250,204,21,0.2)", borderRadius:10, marginBottom:14, fontSize:12, color:"#fde68a", textAlign:"center" }}>
                ⏳ Memuat data santri dari Google Sheets...
              </div>
            )}
            {dbStatus === "error" && (
              <div style={{ padding:"10px 14px", background:"rgba(239,68,68,0.08)", border:"1px solid rgba(239,68,68,0.2)", borderRadius:10, marginBottom:14, fontSize:12, color:"#fca5a5" }}>
                ⚠️ <strong>Gagal memuat data santri.</strong> Pastikan Google Sheets sudah dipublish dan koneksi internet aktif. <button onClick={()=>{setDbStatus("loading");fetch(SHEETS_CSV_URL).then(r=>r.text()).then(t=>{const p=parseCSV(t);if(p.length){setSantriDB(p);setDbStatus("ok");}else setDbStatus("error");}).catch(()=>setDbStatus("error"));}} style={{marginLeft:8,padding:"2px 10px",borderRadius:6,background:"rgba(239,68,68,0.2)",border:"1px solid rgba(239,68,68,0.3)",color:"#fca5a5",cursor:"pointer",fontSize:11}}>Coba Lagi</button>
              </div>
            )}
            {dbStatus === "ok" && (
              <div style={{ padding:"8px 14px", background:"rgba(34,197,94,0.08)", border:"1px solid rgba(34,197,94,0.15)", borderRadius:10, marginBottom:14, fontSize:12, color:"#86efac", textAlign:"center" }}>
                ✅ Database terhubung — <strong>{santriDB.length} santri</strong> berhasil dimuat dari Google Sheets
              </div>
            )}

            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:9, marginBottom:22 }}>
              {[{icon:"👥",label:"Total Santri",val:dbStatus==="ok"?`${santriDB.length}`:"..."},{icon:"⚡",label:"Durasi Sesi",val:"15 Menit"},{icon:"📤",label:"Rekap",val:"WA + Sheets"}].map((s,i)=>(
                <div key={i} style={{...card, padding:"14px 8px", textAlign:"center"}}>
                  <div style={{fontSize:20,marginBottom:3}}>{s.icon}</div>
                  <div style={{fontSize:16,fontWeight:700,color:"#f8fafc"}}>{s.val}</div>
                  <div style={{fontSize:10,color:"#64748b"}}>{s.label}</div>
                </div>
              ))}
            </div>
            <button onClick={() => setScreen("setup")} style={{
              width:"100%", padding:"15px", background:"linear-gradient(135deg,#22c55e,#16a34a)",
              border:"none", borderRadius:12, color:"#fff", fontSize:15, fontWeight:700, cursor:"pointer",
              boxShadow:"0 6px 20px rgba(34,197,94,0.3)", marginBottom:10 }}>
              🚀 Mulai Sesi Absensi
            </button>
            <button onClick={() => setScreen("tahunan")} style={{
              width:"100%", padding:"15px", background:"linear-gradient(135deg,#6366f1,#4f46e5)",
              border:"none", borderRadius:12, color:"#fff", fontSize:15, fontWeight:700, cursor:"pointer",
              boxShadow:"0 6px 20px rgba(99,102,241,0.3)", marginBottom:14 }}>
              📊 Rekap Tahunan Per Santri
            </button>
            <div style={{ padding:12, background:"rgba(59,130,246,0.08)", border:"1px solid rgba(59,130,246,0.2)", borderRadius:10 }}>
              <div style={{fontSize:12,color:"#93c5fd"}}>💡 <strong>Rekap Tahunan</strong> — lihat total hadir & alpha setiap santri per kegiatan selama setahun penuh.</div>
            </div>
          </div>
        )}

        {/* SETUP */}
        {screen === "setup" && (
          <div>
            <h2 style={{fontSize:18,fontWeight:700,marginBottom:18,color:"#f8fafc"}}>⚙️ Buka Sesi Absensi</h2>
            <label style={{display:"block",marginBottom:7,color:"#94a3b8",fontSize:12}}>Pilih Kegiatan</label>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginBottom:18}}>
              {KEGIATAN.map(k => (
                <button key={k} onClick={() => setKegiatan(k)} style={{
                  padding:"10px 12px", borderRadius:9, cursor:"pointer", fontSize:12,
                  background:kegiatan===k?"linear-gradient(135deg,#22c55e,#16a34a)":"rgba(255,255,255,0.04)",
                  border:kegiatan===k?"2px solid #22c55e":"1px solid rgba(255,255,255,0.08)",
                  color:kegiatan===k?"#fff":"#cbd5e1", fontWeight:kegiatan===k?700:400 }}>{k}</button>
              ))}
            </div>
            <input type="text" placeholder="Atau ketik kegiatan lain..."
              value={KEGIATAN.includes(kegiatan)?"":kegiatan} onChange={e=>setKegiatan(e.target.value)}
              style={{width:"100%",padding:"10px 12px",borderRadius:9,marginBottom:18,background:"rgba(255,255,255,0.05)",
                border:"1px solid rgba(255,255,255,0.1)",color:"#f8fafc",fontSize:12,boxSizing:"border-box"}}/>
            <button onClick={startSesi} disabled={!kegiatan} style={{
              width:"100%", padding:"14px", border:"none", borderRadius:11,
              background:kegiatan?"linear-gradient(135deg,#22c55e,#16a34a)":"rgba(255,255,255,0.05)",
              color:kegiatan?"#fff":"#475569", fontSize:14, fontWeight:700, cursor:kegiatan?"pointer":"not-allowed"}}>
              ▶ Mulai — {kegiatan||"Pilih kegiatan dulu"}
            </button>
          </div>
        )}

        {/* SESI */}
        {screen === "sesi" && (
          <div>
            {flash && <div style={{position:"fixed",inset:0,zIndex:200,pointerEvents:"none",
              background:flash==="ok"?"rgba(34,197,94,0.15)":flash==="dup"?"rgba(250,204,21,0.15)":"rgba(248,113,113,0.15)"}}/>}
            <div style={{textAlign:"center",marginBottom:18}}>
              <div style={{fontSize:10,color:"#64748b",marginBottom:3,letterSpacing:2,textTransform:"uppercase"}}>{kegiatan}</div>
              <div style={{position:"relative",display:"inline-block",marginBottom:5}}>
                <svg width="125" height="125" style={{transform:"rotate(-90deg)"}}>
                  <circle cx="62" cy="62" r="54" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="7"/>
                  <circle cx="62" cy="62" r="54" fill="none" stroke={timerColor} strokeWidth="7"
                    strokeDasharray={`${2*Math.PI*54}`} strokeDashoffset={`${2*Math.PI*54*(1-timerPct/100)}`}
                    strokeLinecap="round" style={{transition:"stroke-dashoffset 1s linear,stroke 0.5s"}}/>
                </svg>
                <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                  <div style={{fontSize:26,fontWeight:800,color:timerColor,fontVariantNumeric:"tabular-nums"}}>{fmt(timer)}</div>
                  <div style={{fontSize:10,color:"#64748b"}}>tersisa</div>
                </div>
              </div>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:7,marginBottom:13}}>
              {[{val:totalHadir,label:"Hadir",color:"#4ade80"},{val:alpha.length,label:"Belum",color:"#f87171"},{val:`${persen}%`,label:"Kehadiran",color:"#60a5fa"}].map((s,i)=>(
                <div key={i} style={{...card,padding:"9px 5px",textAlign:"center"}}>
                  <div style={{fontSize:18,fontWeight:800,color:s.color}}>{s.val}</div>
                  <div style={{fontSize:10,color:"#64748b"}}>{s.label}</div>
                </div>
              ))}
            </div>
            <div style={{...card,padding:13,marginBottom:10}}>
              <div style={{fontSize:11,color:"#94a3b8",marginBottom:5}}>📷 Scan QR Santri</div>
              <input ref={inputRef} type="text" value={scanInput} onChange={e=>setScanInput(e.target.value)} onKeyDown={handleScan}
                placeholder="QR-0001 lalu Enter..."
                style={{width:"100%",padding:"10px 11px",borderRadius:8,background:"rgba(255,255,255,0.06)",
                  border:"1px solid rgba(255,255,255,0.12)",color:"#f8fafc",fontSize:12,boxSizing:"border-box"}}/>
              {lastScan && (
                <div style={{marginTop:7,padding:"7px 11px",borderRadius:7,fontSize:12,
                  background:flash==="ok"?"rgba(34,197,94,0.1)":flash==="dup"?"rgba(250,204,21,0.1)":"rgba(248,113,113,0.1)",
                  border:`1px solid ${flash==="ok"?"rgba(34,197,94,0.3)":flash==="dup"?"rgba(250,204,21,0.3)":"rgba(248,113,113,0.3)"}`}}>
                  <strong>{lastScan.nama}</strong> — {lastScan.status}
                </div>
              )}
              <button onClick={simulateScan} style={{marginTop:7,width:"100%",padding:"8px",background:"rgba(99,102,241,0.15)",
                border:"1px solid rgba(99,102,241,0.3)",borderRadius:7,color:"#a5b4fc",fontSize:11,cursor:"pointer"}}>
                🎲 Simulasi Scan Acak (Demo)
              </button>
            </div>
            {logs.length > 0 && (
              <div style={{...card,overflow:"hidden",marginBottom:10}}>
                <div style={{padding:"7px 11px",borderBottom:"1px solid rgba(255,255,255,0.06)",fontSize:10,color:"#64748b",textTransform:"uppercase",letterSpacing:1}}>Log Terbaru</div>
                <div style={{maxHeight:140,overflowY:"auto"}}>
                  {logs.slice(0,7).map((l,i)=>(
                    <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 11px",borderBottom:"1px solid rgba(255,255,255,0.03)",fontSize:11}}>
                      <span><strong style={{color:"#f8fafc"}}>{l.nama}</strong> <span style={{color:"#64748b"}}>{l.kamar}</span></span>
                      <span style={{color:"#4ade80"}}>✅ {l.waktu}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            <button onClick={endSesi} style={{width:"100%",padding:"12px",background:"rgba(239,68,68,0.15)",
              border:"1px solid rgba(239,68,68,0.3)",borderRadius:10,color:"#f87171",fontSize:13,fontWeight:700,cursor:"pointer"}}>
              ⏹ Tutup Sesi & Lihat Rekap
            </button>
          </div>
        )}

        {/* RECAP SESI */}
        {screen === "recap" && (
          <div>
            <div style={{textAlign:"center",marginBottom:20}}>
              <div style={{fontSize:40,marginBottom:5}}>📊</div>
              <h2 style={{fontSize:19,fontWeight:800,color:"#f8fafc",margin:"0 0 3px"}}>Rekap Sesi</h2>
              <div style={{color:"#64748b",fontSize:11}}>{kegiatan} — {todayStr()}</div>
            </div>
            <div style={{background:"linear-gradient(135deg,rgba(34,197,94,0.1),rgba(16,185,129,0.05))",
              border:"1px solid rgba(34,197,94,0.2)",borderRadius:12,padding:16,marginBottom:13}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:10,marginBottom:12}}>
                {[{label:"Total",val:totalSantri,color:"#f8fafc"},{label:"Hadir",val:totalHadir,color:"#4ade80"},
                  {label:"Alpha",val:alpha.length,color:"#f87171"},{label:"Persen",val:`${persen}%`,color:"#60a5fa"}].map((s,i)=>(
                  <div key={i} style={{textAlign:"center"}}>
                    <div style={{fontSize:20,fontWeight:800,color:s.color}}>{s.val}</div>
                    <div style={{fontSize:10,color:"#64748b"}}>{s.label}</div>
                  </div>
                ))}
              </div>
              <div style={{height:6,background:"rgba(255,255,255,0.08)",borderRadius:3,overflow:"hidden"}}>
                <div style={{height:"100%",borderRadius:3,background:"linear-gradient(90deg,#22c55e,#4ade80)",width:`${persen}%`,transition:"width 1s ease"}}/>
              </div>
            </div>

            {/* SIMPAN KE REKAP TAHUNAN */}
            <button onClick={() => simpanKeRekap(hadir)} style={{
              width:"100%", padding:"14px", marginBottom:10,
              background:"linear-gradient(135deg,#6366f1,#4f46e5)",
              border:"none", borderRadius:11, color:"#fff",
              fontSize:14, fontWeight:700, cursor:"pointer",
              boxShadow:"0 4px 16px rgba(99,102,241,0.35)" }}>
              💾 Simpan ke Rekap Tahunan
            </button>
            <div style={{fontSize:11,color:"#64748b",textAlign:"center",marginBottom:12}}>
              ↑ Klik tombol ini agar data sesi ini tersimpan ke rekap tahunan per santri
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:9,marginBottom:9}}>
              <button onClick={generateWA} style={{padding:"12px",borderRadius:10,cursor:"pointer",background:"linear-gradient(135deg,#25D366,#128C7E)",border:"none",color:"#fff",fontSize:12,fontWeight:700}}>📲 WhatsApp</button>
              <button onClick={downloadCSV} style={{padding:"12px",borderRadius:10,cursor:"pointer",background:"linear-gradient(135deg,#34a853,#0f9d58)",border:"none",color:"#fff",fontSize:12,fontWeight:700}}>📊 Export Sheets</button>
            </div>
            <button onClick={() => setScreen("tahunan")} style={{width:"100%",padding:"11px",marginBottom:7,
              background:"rgba(99,102,241,0.1)",border:"1px solid rgba(99,102,241,0.3)",
              borderRadius:10,color:"#a5b4fc",fontSize:12,fontWeight:600,cursor:"pointer"}}>
              📊 Lihat Rekap Tahunan Per Santri →
            </button>
            <button onClick={() => { setScreen("home"); setKegiatan(""); }} style={{width:"100%",padding:"10px",
              background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",
              borderRadius:10,color:"#94a3b8",fontSize:12,cursor:"pointer"}}>🔄 Sesi Baru</button>
          </div>
        )}

        {/* REKAP TAHUNAN — LIST */}
        {screen === "tahunan" && !selectedSantri && (
          <div>
            <div style={{marginBottom:18}}>
              <h2 style={{fontSize:18,fontWeight:800,color:"#f8fafc",margin:"0 0 3px"}}>📊 Rekap Tahunan Per Santri</h2>
              <div style={{fontSize:11,color:"#64748b"}}>Tahun {thisYear()} — {santriDB.length} santri terdaftar</div>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginBottom:9}}>
              <input type="text" placeholder="🔍 Cari nama / ID..."
                value={searchQuery} onChange={e=>setSearchQuery(e.target.value)}
                style={{gridColumn:"1 / -1",padding:"9px 11px",borderRadius:9,background:"rgba(255,255,255,0.06)",
                  border:"1px solid rgba(255,255,255,0.1)",color:"#f8fafc",fontSize:12,boxSizing:"border-box"}}/>
              <select value={filterKamar} onChange={e=>setFilterKamar(e.target.value)} style={{padding:"8px 9px",borderRadius:8,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#f8fafc",fontSize:11}}>
                {kamarList.map(k=><option key={k} value={k} style={{background:"#1e293b"}}>{k}</option>)}
              </select>
              <select value={filterKegiatan} onChange={e=>setFilterKegiatan(e.target.value)} style={{padding:"8px 9px",borderRadius:8,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#f8fafc",fontSize:11}}>
                {kegiatanList.map(k=><option key={k} value={k} style={{background:"#1e293b"}}>{k}</option>)}
              </select>
            </div>

            <div style={{display:"flex",gap:5,marginBottom:12,flexWrap:"wrap"}}>
              <span style={{fontSize:10,color:"#64748b",alignSelf:"center"}}>Urut:</span>
              {[["nama","A-Z"],["hadir","Hadir ↓"],["alpha","Alpha ↓"],["persen","% ↓"]].map(([val,label])=>(
                <button key={val} onClick={()=>setSortBy(val)} style={{padding:"4px 10px",borderRadius:20,cursor:"pointer",fontSize:10,
                  background:sortBy===val?"rgba(99,102,241,0.3)":"rgba(255,255,255,0.05)",
                  border:sortBy===val?"1px solid rgba(99,102,241,0.5)":"1px solid rgba(255,255,255,0.08)",
                  color:sortBy===val?"#a5b4fc":"#64748b"}}>{label}</button>
              ))}
            </div>

            {/* Ringkasan */}
            {(() => {
              const tH = santriFiltered.reduce((a,s)=>a+s.stat.totalH,0);
              const tA = santriFiltered.reduce((a,s)=>a+s.stat.totalA,0);
              return (
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:7,marginBottom:12}}>
                  {[{icon:"✅",label:"Total Hadir",val:tH,color:"#4ade80"},{icon:"❌",label:"Total Alpha",val:tA,color:"#f87171"},{icon:"📋",label:"Total Sesi",val:tH+tA,color:"#60a5fa"}].map((s,i)=>(
                    <div key={i} style={{...card,padding:"9px 7px",textAlign:"center"}}>
                      <div style={{fontSize:9,marginBottom:1}}>{s.icon}</div>
                      <div style={{fontSize:17,fontWeight:800,color:s.color}}>{s.val}</div>
                      <div style={{fontSize:9,color:"#64748b"}}>{s.label}</div>
                    </div>
                  ))}
                </div>
              );
            })()}

            {/* Tabel santri */}
            <div style={{...card,overflow:"hidden",marginBottom:12}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 55px 55px 55px 48px",padding:"8px 12px",borderBottom:"1px solid rgba(255,255,255,0.08)",background:"rgba(255,255,255,0.03)"}}>
                {["Nama Santri","Hadir","Alpha","Sesi","%"].map((h,i)=>(
                  <div key={i} style={{fontSize:9,color:"#64748b",textTransform:"uppercase",letterSpacing:0.5,textAlign:i>0?"center":"left"}}>{h}</div>
                ))}
              </div>
              <div style={{maxHeight:360,overflowY:"auto"}}>
                {santriFiltered.length === 0 ? (
                  <div style={{padding:20,textAlign:"center",color:"#64748b",fontSize:12}}>Tidak ada data ditemukan</div>
                ) : santriFiltered.map((s,i) => {
                  const pc = s.stat.persen;
                  const pcColor = pc>=80?"#4ade80":pc>=60?"#facc15":pc>0?"#f87171":"#475569";
                  return (
                    <div key={i} onClick={()=>setSelectedSantri(s)}
                      style={{display:"grid",gridTemplateColumns:"1fr 55px 55px 55px 48px",padding:"9px 12px",
                        borderBottom:"1px solid rgba(255,255,255,0.04)",cursor:"pointer",transition:"background 0.15s"}}
                      onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.04)"}
                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      <div>
                        <div style={{fontSize:12,color:"#f8fafc",fontWeight:600}}>{s.nama}</div>
                        <div style={{fontSize:9,color:"#64748b"}}>{s.kamar} · {s.id}</div>
                      </div>
                      <div style={{textAlign:"center",fontSize:13,color:"#4ade80",fontWeight:700,alignSelf:"center"}}>{s.stat.totalH}</div>
                      <div style={{textAlign:"center",fontSize:13,color:"#f87171",fontWeight:700,alignSelf:"center"}}>{s.stat.totalA}</div>
                      <div style={{textAlign:"center",fontSize:12,color:"#94a3b8",alignSelf:"center"}}>{s.stat.total}</div>
                      <div style={{textAlign:"center",fontSize:11,color:pcColor,fontWeight:700,alignSelf:"center"}}>{s.stat.total>0?`${pc}%`:"-"}</div>
                    </div>
                  );
                })}
              </div>
            </div>

            <button onClick={downloadCSVTahunan} style={{width:"100%",padding:"12px",background:"linear-gradient(135deg,#34a853,#0f9d58)",
              border:"none",borderRadius:10,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer"}}>
              📥 Export Rekap Tahunan → Excel / Google Sheets
            </button>
          </div>
        )}

        {/* DETAIL SANTRI */}
        {screen === "tahunan" && selectedSantri && (() => {
          const tahun = thisYear();
          const data = rekapTahunan[selectedSantri.id]?.[tahun] || {};
          const stat = getStatSantri(selectedSantri.id, tahun, filterKegiatan);
          return (
            <div>
              <button onClick={()=>setSelectedSantri(null)} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",
                borderRadius:8,color:"#94a3b8",padding:"5px 11px",cursor:"pointer",fontSize:11,marginBottom:14}}>← Kembali</button>

              <div style={{...card,padding:16,marginBottom:14}}>
                <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:14}}>
                  <div style={{width:48,height:48,borderRadius:"50%",background:"linear-gradient(135deg,#6366f1,#4f46e5)",
                    display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0,color:"#fff",fontWeight:800}}>
                    {selectedSantri.nama.charAt(0)}
                  </div>
                  <div>
                    <div style={{fontSize:16,fontWeight:800,color:"#f8fafc"}}>{selectedSantri.nama}</div>
                    <div style={{fontSize:11,color:"#64748b"}}>{selectedSantri.kamar} · {selectedSantri.id}</div>
                    <div style={{fontSize:10,color:"#64748b",marginTop:1}}>Rekap Tahun {tahun}</div>
                  </div>
                </div>

                {/* 4 angka utama */}
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8,marginBottom:12}}>
                  {[
                    {label:"Total Sesi",val:stat.total,color:"#94a3b8"},
                    {label:"Hadir",val:stat.totalH,color:"#4ade80"},
                    {label:"Alpha",val:stat.totalA,color:"#f87171"},
                    {label:"Kehadiran",val:stat.total>0?`${stat.persen}%`:"-",
                      color:stat.persen>=80?"#4ade80":stat.persen>=60?"#facc15":"#f87171"},
                  ].map((s,i)=>(
                    <div key={i} style={{textAlign:"center",background:"rgba(255,255,255,0.05)",borderRadius:9,padding:"9px 5px"}}>
                      <div style={{fontSize:19,fontWeight:800,color:s.color}}>{s.val}</div>
                      <div style={{fontSize:9,color:"#64748b"}}>{s.label}</div>
                    </div>
                  ))}
                </div>

                {stat.total > 0 && (
                  <div>
                    <div style={{height:7,background:"rgba(255,255,255,0.08)",borderRadius:4,overflow:"hidden"}}>
                      <div style={{height:"100%",borderRadius:4,width:`${stat.persen}%`,transition:"width 1s ease",
                        background:stat.persen>=80?"linear-gradient(90deg,#22c55e,#4ade80)":stat.persen>=60?"linear-gradient(90deg,#f59e0b,#facc15)":"linear-gradient(90deg,#ef4444,#f87171)"}}/>
                    </div>
                    <div style={{fontSize:10,color:"#64748b",marginTop:3,textAlign:"right"}}>
                      {stat.totalH}x hadir dari {stat.total}x total sesi
                    </div>
                  </div>
                )}
              </div>

              {/* Per kegiatan */}
              {Object.keys(data).length > 0 ? (
                <div style={{...card,overflow:"hidden",marginBottom:12}}>
                  <div style={{padding:"9px 13px",borderBottom:"1px solid rgba(255,255,255,0.07)",fontSize:11,color:"#94a3b8",fontWeight:600}}>
                    📌 Rincian Per Kegiatan
                  </div>
                  {Object.entries(data).map(([kg,val],i)=>{
                    const tot = val.hadir+val.alpha;
                    const pc = tot>0?Math.round(val.hadir/tot*100):0;
                    const pcColor = pc>=80?"#4ade80":pc>=60?"#facc15":"#f87171";
                    return (
                      <div key={i} style={{padding:"11px 13px",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                          <span style={{fontSize:12,color:"#f8fafc",fontWeight:600}}>{kg}</span>
                          <span style={{fontSize:12,color:pcColor,fontWeight:700}}>{pc}%</span>
                        </div>
                        <div style={{display:"flex",gap:14,marginBottom:5}}>
                          <span style={{fontSize:11,color:"#4ade80"}}>✅ Hadir: <strong>{val.hadir}x</strong></span>
                          <span style={{fontSize:11,color:"#f87171"}}>❌ Alpha: <strong>{val.alpha}x</strong></span>
                          <span style={{fontSize:11,color:"#64748b"}}>Total: {tot}x</span>
                        </div>
                        <div style={{height:4,background:"rgba(255,255,255,0.06)",borderRadius:2,overflow:"hidden"}}>
                          <div style={{height:"100%",borderRadius:2,width:`${pc}%`,background:pc>=80?"#22c55e":pc>=60?"#f59e0b":"#ef4444"}}/>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{...card,padding:20,textAlign:"center",marginBottom:12}}>
                  <div style={{fontSize:28,marginBottom:7}}>📭</div>
                  <div style={{color:"#64748b",fontSize:12}}>Belum ada data absensi untuk santri ini.</div>
                  <div style={{color:"#475569",fontSize:10,marginTop:3}}>Selesaikan sesi lalu klik "Simpan ke Rekap Tahunan".</div>
                </div>
              )}

              {/* Riwayat */}
              {Object.values(data).some(v=>v.riwayat?.length>0) && (
                <div style={{...card,overflow:"hidden"}}>
                  <div style={{padding:"9px 13px",borderBottom:"1px solid rgba(255,255,255,0.07)",fontSize:11,color:"#94a3b8",fontWeight:600}}>
                    🕐 Riwayat Sesi Terakhir
                  </div>
                  <div style={{maxHeight:190,overflowY:"auto"}}>
                    {Object.entries(data).flatMap(([kg,val])=>(val.riwayat||[]).map(r=>({...r,kg})))
                      .slice(-15).reverse().map((r,i)=>(
                      <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"7px 13px",borderBottom:"1px solid rgba(255,255,255,0.03)",fontSize:11}}>
                        <div>
                          <span style={{color:"#f8fafc"}}>{r.kg}</span>
                          <span style={{color:"#64748b",marginLeft:6}}>{r.tanggal}</span>
                        </div>
                        <span style={{color:r.status==="hadir"?"#4ade80":"#f87171",fontWeight:600}}>
                          {r.status==="hadir"?`✅ ${r.waktu}`:"❌ Alpha"}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

      </div>
    </div>
  );
}

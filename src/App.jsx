import { useState, useEffect, useRef, useCallback } from "react";

// ─── Konstanta ─────────────────────────────────────────────────────────────
const DURATION = 15 * 60;

const KEGIATAN = [
  "Sholat Subuh","Sholat Dzuhur","Sholat Ashar",
  "Sholat Maghrib","Sholat Isya","Tahajjud",
  "Kajian Kitab","Tahfidz","Muhadharah","Piket"
];

// Struktur Rayon & Kamar
const RAYON_KAMAR = {
  "Khalid Bin Walid B": [310,313,314,316],
  "Khalid Bin Walid A": [317,319,320,322],
  "Ibnu Rusyd B": [303,305,306,327,328,330,331,333,334,336,337],
  "Ibnu Rusyd A": [339,340,342,343],
  "Ibnu Khaldun (Sa'id)": [344,345,346,347,348],
  "Ibnu Sina": [353,356,359],
  "Umar Bin Khattab": [361,362,363,364,365,366,367,368,369,373,375,376,377,378,379],
  "Abu Hurairah": [1,2,3,4,5,6,7,8,9,10,11,12],
};

const SEMUA_RAYON = Object.keys(RAYON_KAMAR);
const SEMUA_KAMAR = Object.entries(RAYON_KAMAR).flatMap(([rayon, kamar]) =>
  kamar.map(k => ({ rayon, kamar: String(k) }))
);

// Kelas 1A-6F
const HURUF = ["A","B","C","D","E","F"];
const SEMUA_KELAS = Array.from({length:6}, (_,i) =>
  HURUF.map(h => `Kelas ${i+1} ${h}`)
).flat();

const SHEETS_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRHyGfi-heXx4sC43HGtLFeWa9ahh-fh1eFPD6k5m-QD2b5M_mWQiSl-bJLkD0cx0MCpJ7mPy5uF8EB/pub?gid=0&single=true&output=csv";

const parseCSV = (text) => {
  const lines = text.trim().split("\n");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().replace(/\r/g,"").toLowerCase());
  return lines.slice(1).map((line, idx) => {
    const vals = line.split(",").map(v => v.trim().replace(/\r/g,""));
    const obj = {};
    headers.forEach((h, i) => obj[h] = vals[i] || "");
    const qrRaw = obj["qr code"] || obj["qr_code"] || obj["kode qr"] || obj["qr"] || obj["kode"] || "";
    const qrNorm = qrRaw.trim().toUpperCase();
    const idRaw = obj.id || obj["id santri"] || obj["no"] || `STR-${String(idx+1).padStart(4,"0")}`;
    return {
      id: idRaw.trim().toUpperCase(),
      nama: obj.nama || obj["nama santri"] || obj["name"] || "Tanpa Nama",
      rayon: obj.rayon || obj["asrama"] || obj["gedung"] || "-",
      kamar: obj.kamar || obj["no kamar"] || obj["nomor kamar"] || "-",
      kelas: obj.kelas || obj["kelas/tingkat"] || obj["tingkat"] || "-",
      qr: qrNorm,
    };
  }).filter(s => s.nama && s.nama !== "Tanpa Nama");
};

// ─── Storage ──────────────────────────────────────────────────────────────
const STORAGE_KEY = "absensi_pesantren_rekap_v3";
const loadRekap = () => {
  try { const r = localStorage.getItem(STORAGE_KEY); return r ? JSON.parse(r) : {}; }
  catch { return {}; }
};
const saveRekap = (data) => {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); } catch {}
};

// ─── Helpers ─────────────────────────────────────────────────────────────
const fmt = (s) => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(s%60).padStart(2,"0")}`;
const nowTime = () => new Date().toLocaleTimeString("id-ID",{hour:"2-digit",minute:"2-digit"});
const todayStr = () => new Date().toLocaleDateString("id-ID",{weekday:"long",day:"numeric",month:"long",year:"numeric"});
const thisYear = () => new Date().getFullYear();

// ─── QR Scanner ───────────────────────────────────────────────────────────
function QRScanner({ onDetected }) {
  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const animRef = useRef(null);
  const [status, setStatus] = useState("idle");
  const [errMsg, setErrMsg] = useState("");
  const lastCode = useRef("");
  const lastCodeTime = useRef(0);

  const startCamera = async () => {
    setStatus("loading"); setErrMsg("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal:"environment" }, width:{ideal:1280}, height:{ideal:720} }
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setStatus("active");
        scanLoop();
      }
    } catch(err) {
      let msg = "Tidak dapat membuka kamera.";
      if (err.name==="NotAllowedError") msg = "Izin kamera ditolak. Klik ikon kunci di address bar lalu izinkan kamera.";
      else if (err.name==="NotFoundError") msg = "Kamera tidak ditemukan.";
      else if (err.name==="NotReadableError") msg = "Kamera digunakan aplikasi lain. Tutup lalu coba lagi.";
      setErrMsg(msg); setStatus("error");
    }
  };

  const scanLoop = () => {
    if (!videoRef.current || !canvasRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d", { willReadFrequently:true });
    const tick = () => {
      if (video.readyState === video.HAVE_ENOUGH_DATA) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        if ("BarcodeDetector" in window) {
          const detector = new window.BarcodeDetector({ formats:["qr_code"] });
          detector.detect(canvas).then(codes => {
            if (codes.length > 0) {
              const val = codes[0].rawValue;
              const now = Date.now();
              if (val !== lastCode.current || now - lastCodeTime.current > 3000) {
                lastCode.current = val;
                lastCodeTime.current = now;
                onDetected(val.trim().toUpperCase());
              }
            }
          }).catch(()=>{});
        }
      }
      animRef.current = requestAnimationFrame(tick);
    };
    animRef.current = requestAnimationFrame(tick);
  };

  const stopCamera = () => {
    if (animRef.current) cancelAnimationFrame(animRef.current);
    if (streamRef.current) { streamRef.current.getTracks().forEach(t=>t.stop()); streamRef.current=null; }
    setStatus("idle");
  };

  useEffect(() => () => stopCamera(), []);

  return (
    <div style={{width:"100%"}}>
      <div style={{position:"relative",width:"100%",aspectRatio:"4/3",background:"#000",borderRadius:12,overflow:"hidden",marginBottom:10,border:"2px solid rgba(255,255,255,0.08)"}}>
        <video ref={videoRef} playsInline autoPlay muted style={{width:"100%",height:"100%",objectFit:"cover",display:status==="active"?"block":"none"}}/>
        <canvas ref={canvasRef} style={{display:"none"}}/>
        {status==="active" && (
          <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",pointerEvents:"none"}}>
            <div style={{position:"relative",width:200,height:200}}>
              <div style={{position:"absolute",top:0,left:0,width:36,height:36,borderTop:"4px solid #4ade80",borderLeft:"4px solid #4ade80",borderRadius:"4px 0 0 0"}}/>
              <div style={{position:"absolute",top:0,right:0,width:36,height:36,borderTop:"4px solid #4ade80",borderRight:"4px solid #4ade80",borderRadius:"0 4px 0 0"}}/>
              <div style={{position:"absolute",bottom:0,left:0,width:36,height:36,borderBottom:"4px solid #4ade80",borderLeft:"4px solid #4ade80",borderRadius:"0 0 0 4px"}}/>
              <div style={{position:"absolute",bottom:0,right:0,width:36,height:36,borderBottom:"4px solid #4ade80",borderRight:"4px solid #4ade80",borderRadius:"0 0 4px 0"}}/>
              <style>{`@keyframes scanLine{0%{top:10%}50%{top:85%}100%{top:10%}}`}</style>
              <div style={{position:"absolute",left:8,right:8,height:2,background:"linear-gradient(90deg,transparent,#4ade80,transparent)",animation:"scanLine 2s linear infinite",top:"50%"}}/>
            </div>
          </div>
        )}
        {status==="idle" && (
          <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
            <div style={{fontSize:44,marginBottom:8}}>📷</div>
            <div style={{color:"#475569",fontSize:12}}>Kamera belum aktif</div>
          </div>
        )}
        {status==="loading" && (
          <div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center"}}>
            <div style={{fontSize:13,color:"#94a3b8"}}>⏳ Membuka kamera...</div>
          </div>
        )}
        {status==="error" && (
          <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:20}}>
            <div style={{fontSize:28,marginBottom:8}}>⚠️</div>
            <div style={{color:"#f87171",fontSize:11,textAlign:"center",lineHeight:1.5}}>{errMsg}</div>
          </div>
        )}
      </div>
      {status!=="active" ? (
        <button onClick={startCamera} style={{width:"100%",padding:"12px",background:"linear-gradient(135deg,#22c55e,#16a34a)",border:"none",borderRadius:10,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",boxShadow:"0 4px 14px rgba(34,197,94,0.3)",marginBottom:8}}>
          {status==="loading"?"⏳ Membuka kamera...":"📷 Buka Kamera & Scan QR"}
        </button>
      ) : (
        <button onClick={stopCamera} style={{width:"100%",padding:"11px",background:"rgba(239,68,68,0.15)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:10,color:"#f87171",fontSize:12,fontWeight:600,cursor:"pointer",marginBottom:8}}>
          ⏸ Tutup Kamera
        </button>
      )}
      {status==="idle" && <div style={{fontSize:10,color:"#475569",textAlign:"center",marginBottom:4}}>💡 Gunakan Chrome / Safari & izinkan akses kamera</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
export default function AbsensiPesantren() {
  const [screen, setScreen] = useState("home");
  const [kegiatan, setKegiatan] = useState("");

  // Filter sesi: "semua" | "rayon" | "kamar" | "kelas"
  const [filterMode, setFilterMode] = useState("semua");
  const [filterRayon, setFilterRayon] = useState("");
  const [filterKamar, setFilterKamar] = useState("");
  const [filterKelas, setFilterKelas] = useState("");

  const [timer, setTimer] = useState(DURATION);
  const [hadir, setHadir] = useState({});
  const [scanInput, setScanInput] = useState("");
  const [lastScan, setLastScan] = useState(null);
  const [flash, setFlash] = useState(null);
  const [logs, setLogs] = useState([]);
  const [rekapTahunan, setRekapTahunan] = useState(loadRekap);
  const [santriDB, setSantriDB] = useState([]);
  const [dbStatus, setDbStatus] = useState("loading");
  const [savedNotif, setSavedNotif] = useState(false);

  // Rekap tahunan filter
  const [searchQuery, setSearchQuery] = useState("");
  const [rekapFilterKamar, setRekapFilterKamar] = useState("Semua");
  const [rekapFilterKegiatan, setRekapFilterKegiatan] = useState("Semua");
  const [selectedSantri, setSelectedSantri] = useState(null);
  const [sortBy, setSortBy] = useState("nama");

  const inputRef = useRef(null);
  const intervalRef = useRef(null);
  const lastDetected = useRef("");
  const lastDetectedTime = useRef(0);

  // ── Fetch Google Sheets ──
  const fetchSantri = () => {
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
  };

  useEffect(() => { fetchSantri(); }, []);
  useEffect(() => { saveRekap(rekapTahunan); }, [rekapTahunan]);

  useEffect(() => {
    if (screen !== "sesi") return;
    intervalRef.current = setInterval(() => {
      setTimer(t => {
        if (t <= 1) { clearInterval(intervalRef.current); setScreen("recap"); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => clearInterval(intervalRef.current);
  }, [screen]);

  // ── Santri yang akan diabsen berdasarkan filter ──
  const santriSesi = useCallback(() => {
    if (filterMode === "semua") return santriDB;
    if (filterMode === "rayon") return santriDB.filter(s => s.rayon === filterRayon);
    if (filterMode === "kamar") return santriDB.filter(s => String(s.kamar) === String(filterKamar) && s.rayon === filterRayon);
    if (filterMode === "kelas") return santriDB.filter(s => s.kelas === filterKelas);
    return santriDB;
  }, [santriDB, filterMode, filterRayon, filterKamar, filterKelas]);

  const labelSesi = () => {
    if (filterMode === "semua") return "Semua Santri";
    if (filterMode === "rayon") return `Rayon ${filterRayon}`;
    if (filterMode === "kamar") return `Kamar ${filterKamar} (${filterRayon})`;
    if (filterMode === "kelas") return filterKelas;
    return "";
  };

  const startSesi = () => {
    if (!kegiatan) return;
    if (filterMode === "rayon" && !filterRayon) return;
    if (filterMode === "kamar" && (!filterRayon || !filterKamar)) return;
    if (filterMode === "kelas" && !filterKelas) return;
    setHadir({}); setLogs([]); setTimer(DURATION); setLastScan(null);
    setScreen("sesi");
  };

  const canStart = () => {
    if (!kegiatan) return false;
    if (filterMode === "rayon" && !filterRayon) return false;
    if (filterMode === "kamar" && (!filterRayon || !filterKamar)) return false;
    if (filterMode === "kelas" && !filterKelas) return false;
    return true;
  };

  // ── Proses QR ──
  const prosesKode = useCallback((val) => {
    const now = Date.now();
    if (val === lastDetected.current && now - lastDetectedTime.current < 2000) return;
    lastDetected.current = val;
    lastDetectedTime.current = now;

    const valNorm = val.trim().toUpperCase();
    const target = santriSesi();
    const santri = target.find(s => s.qr === valNorm || s.id === valNorm);

    if (!santri) {
      // Cek apakah ada di DB tapi beda filter
      const adaDiDB = santriDB.find(s => s.qr === valNorm || s.id === valNorm);
      setFlash("err");
      setLastScan({ nama: valNorm, status: adaDiDB ? `Bukan bagian dari ${labelSesi()} ⚠️` : "Tidak Ditemukan ❌" });
      setTimeout(() => setFlash(null), 1500); return;
    }
    if (hadir[santri.id]) {
      setFlash("dup");
      setLastScan({ nama: santri.nama, status: "Sudah Absen ⚠️" });
      setTimeout(() => setFlash(null), 1500); return;
    }
    const waktu = nowTime();
    setHadir(prev => ({ ...prev, [santri.id]: waktu }));
    setLogs(prev => [{ ...santri, waktu }, ...prev]);
    setFlash("ok");
    setLastScan({ nama: santri.nama, status: `Hadir ✅ — ${waktu}` });
    setTimeout(() => setFlash(null), 1500);
  }, [santriDB, santriSesi, hadir, filterMode, filterRayon, filterKamar, filterKelas]);

  const handleManualInput = (e) => {
    if (e.key !== "Enter") return;
    const val = scanInput.trim().toUpperCase();
    if (!val) return;
    setScanInput(""); prosesKode(val);
  };

  const simulateScan = () => {
    const target = santriSesi();
    const belum = target.filter(s => !hadir[s.id]);
    if (!belum.length) return;
    const pick = belum[Math.floor(Math.random() * belum.length)];
    prosesKode(pick.qr || pick.id);
  };

  const simpanKeRekap = () => {
    const tahun = thisYear();
    const tanggal = new Date().toLocaleDateString("id-ID");
    const target = santriSesi();
    setRekapTahunan(prev => {
      const updated = { ...prev };
      target.forEach(s => {
        if (!updated[s.id]) updated[s.id] = {};
        if (!updated[s.id][tahun]) updated[s.id][tahun] = {};
        if (!updated[s.id][tahun][kegiatan]) updated[s.id][tahun][kegiatan] = { hadir:0, alpha:0, riwayat:[] };
        const status = hadir[s.id] ? "hadir" : "alpha";
        updated[s.id][tahun][kegiatan][status] += 1;
        updated[s.id][tahun][kegiatan].riwayat.push({ tanggal, status, waktu: hadir[s.id]||null });
      });
      return updated;
    });
    setSavedNotif(true); setTimeout(() => setSavedNotif(false), 2500);
  };

  const target = santriSesi();
  const totalHadir = Object.keys(hadir).length;
  const totalTarget = target.length;
  const persen = totalTarget > 0 ? Math.round((totalHadir / totalTarget) * 100) : 0;
  const alphaList = target.filter(s => !hadir[s.id]);
  const timerPct = (timer / DURATION) * 100;
  const timerColor = timer > 300 ? "#4ade80" : timer > 120 ? "#facc15" : "#f87171";

  const generateWA = () => {
    const lines = [
      `🕌 *REKAP ABSENSI PESANTREN*`, `📅 ${todayStr()}`,
      `📌 Kegiatan: *${kegiatan}*`, `👥 Kelompok: *${labelSesi()}*`, ``,
      `✅ Hadir      : ${totalHadir} santri`,
      `❌ Tidak Hadir: ${alphaList.length} santri`,
      `📊 Persentase : ${persen}%`, ``,
      `*Daftar Tidak Hadir:*`,
      ...alphaList.map(s=>`• ${s.nama} (${s.rayon} - Kamar ${s.kamar})`), ``,
      `_Generated otomatis — Sistem Absensi Pesantren_`
    ].join("\n");
    window.open(`https://wa.me/?text=${encodeURIComponent(lines)}`, "_blank");
  };

  const downloadCSV = () => {
    const rows = [["ID","Nama","Rayon","Kamar","Kelas","Status","Waktu","Kegiatan","Kelompok","Tanggal"]];
    target.forEach(s => rows.push([s.id,s.nama,s.rayon,s.kamar,s.kelas,hadir[s.id]?"Hadir":"Alpha",hadir[s.id]||"-",kegiatan,labelSesi(),new Date().toLocaleDateString("id-ID")]));
    const blob = new Blob([rows.map(r=>r.join(",")).join("\n")],{type:"text/csv"});
    const a = document.createElement("a"); a.href=URL.createObjectURL(blob);
    a.download=`absensi-${kegiatan.replace(/ /g,"_")}-${labelSesi().replace(/ /g,"_")}-${Date.now()}.csv`; a.click();
  };

  const getStatSantri = (id, tahun=thisYear(), kgFilter="Semua") => {
    const data = rekapTahunan[id]?.[tahun] || {};
    let tH=0, tA=0; const perKg={};
    Object.entries(data).forEach(([kg,val]) => {
      if (kgFilter !== "Semua" && kg !== kgFilter) return;
      tH += val.hadir; tA += val.alpha; perKg[kg] = val;
    });
    const tot = tH+tA;
    return { totalH:tH, totalA:tA, total:tot, persen:tot>0?Math.round(tH/tot*100):0, perKg };
  };

  const downloadCSVTahunan = () => {
    const tahun = thisYear();
    const rows=[["ID","Nama","Rayon","Kamar","Kelas","Kegiatan","Total Sesi","Hadir","Alpha","Persentase"]];
    santriDB.forEach(s => {
      const data = rekapTahunan[s.id]?.[tahun]||{};
      if (!Object.keys(data).length) { rows.push([s.id,s.nama,s.rayon,s.kamar,s.kelas,"-",0,0,0,"0%"]); return; }
      Object.entries(data).forEach(([kg,val]) => {
        const tot=val.hadir+val.alpha;
        rows.push([s.id,s.nama,s.rayon,s.kamar,s.kelas,kg,tot,val.hadir,val.alpha,`${tot>0?Math.round(val.hadir/tot*100):0}%`]);
      });
    });
    const blob=new Blob([rows.map(r=>r.join(",")).join("\n")],{type:"text/csv"});
    const a=document.createElement("a"); a.href=URL.createObjectURL(blob);
    a.download=`rekap-tahunan-${tahun}.csv`; a.click();
  };

  const kamarListRekap = ["Semua",...new Set(santriDB.map(s=>s.rayon).filter(Boolean))];
  const kegiatanListRekap = ["Semua",...KEGIATAN];
  const santriFiltered = santriDB
    .filter(s => rekapFilterKamar==="Semua" || s.rayon===rekapFilterKamar)
    .filter(s => searchQuery==="" || s.nama.toLowerCase().includes(searchQuery.toLowerCase()) || s.id.toLowerCase().includes(searchQuery.toLowerCase()) || s.kamar.toString().includes(searchQuery) || s.kelas.toLowerCase().includes(searchQuery.toLowerCase()))
    .map(s => ({...s, stat:getStatSantri(s.id,thisYear(),rekapFilterKegiatan)}))
    .sort((a,b) => {
      if (sortBy==="hadir") return b.stat.totalH-a.stat.totalH;
      if (sortBy==="alpha") return b.stat.totalA-a.stat.totalA;
      if (sortBy==="persen") return b.stat.persen-a.stat.persen;
      return a.nama.localeCompare(b.nama);
    });

  const card = { background:"rgba(255,255,255,0.04)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:12 };
  const select = { padding:"9px 10px", borderRadius:9, background:"rgba(255,255,255,0.06)", border:"1px solid rgba(255,255,255,0.1)", color:"#f8fafc", fontSize:12, width:"100%", boxSizing:"border-box" };

  // ─── RENDER ────────────────────────────────────────────────────────────
  return (
    <div style={{minHeight:"100vh",background:"linear-gradient(135deg,#0f172a 0%,#1e293b 50%,#0f2027 100%)",fontFamily:"'Segoe UI',system-ui,sans-serif",color:"#e2e8f0"}}>

      {savedNotif && (
        <div style={{position:"fixed",top:70,left:"50%",transform:"translateX(-50%)",zIndex:999,background:"linear-gradient(135deg,#22c55e,#16a34a)",color:"#fff",padding:"10px 24px",borderRadius:30,fontSize:13,fontWeight:700,boxShadow:"0 4px 20px rgba(34,197,94,0.4)",whiteSpace:"nowrap"}}>
          ✅ Tersimpan ke Rekap Tahunan!
        </div>
      )}
      {flash && <div style={{position:"fixed",inset:0,zIndex:200,pointerEvents:"none",background:flash==="ok"?"rgba(34,197,94,0.18)":flash==="dup"?"rgba(250,204,21,0.18)":"rgba(248,113,113,0.18)"}}/>}

      {/* Header */}
      <header style={{background:"rgba(255,255,255,0.03)",borderBottom:"1px solid rgba(255,255,255,0.08)",padding:"12px 18px",display:"flex",alignItems:"center",gap:10,position:"sticky",top:0,zIndex:100,backdropFilter:"blur(12px)"}}>
        <div style={{fontSize:22}}>🕌</div>
        <div style={{flex:1}}>
          <div style={{fontWeight:700,fontSize:14,color:"#f8fafc"}}>Sistem Absensi Pesantren</div>
          <div style={{fontSize:10,color:"#64748b"}}>{todayStr()}</div>
        </div>
        {screen!=="home" && (
          <button onClick={()=>{setScreen("home");setSelectedSantri(null);clearInterval(intervalRef.current);}} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,color:"#94a3b8",padding:"5px 11px",cursor:"pointer",fontSize:11}}>← Beranda</button>
        )}
      </header>

      <div style={{maxWidth:680,margin:"0 auto",padding:"16px 13px"}}>

        {/* ══ HOME ══ */}
        {screen==="home" && (
          <div>
            <div style={{textAlign:"center",marginBottom:20,paddingTop:8}}>
              <div style={{fontSize:48,marginBottom:6}}>📋</div>
              <h1 style={{fontSize:21,fontWeight:800,color:"#f8fafc",margin:"0 0 4px"}}>Absensi Digital Pesantren</h1>
              <p style={{color:"#64748b",fontSize:11,margin:0}}>Sistem absensi QR Code — cepat, akurat, otomatis</p>
            </div>

            {dbStatus==="loading" && <div style={{padding:"9px 14px",background:"rgba(250,204,21,0.08)",border:"1px solid rgba(250,204,21,0.2)",borderRadius:10,marginBottom:10,fontSize:12,color:"#fde68a",textAlign:"center"}}>⏳ Memuat data santri dari Google Sheets...</div>}
            {dbStatus==="error" && (
              <div style={{padding:"9px 14px",background:"rgba(239,68,68,0.08)",border:"1px solid rgba(239,68,68,0.2)",borderRadius:10,marginBottom:10,fontSize:12,color:"#fca5a5",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
                <span>⚠️ Gagal memuat data santri.</span>
                <button onClick={fetchSantri} style={{padding:"3px 10px",borderRadius:6,background:"rgba(239,68,68,0.2)",border:"1px solid rgba(239,68,68,0.3)",color:"#fca5a5",cursor:"pointer",fontSize:11}}>Coba Lagi</button>
              </div>
            )}
            {dbStatus==="ok" && <div style={{padding:"8px 14px",background:"rgba(34,197,94,0.08)",border:"1px solid rgba(34,197,94,0.15)",borderRadius:10,marginBottom:10,fontSize:12,color:"#86efac",textAlign:"center"}}>✅ <strong>{santriDB.length} santri</strong> berhasil dimuat dari Google Sheets</div>}

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:8,marginBottom:18}}>
              {[{icon:"👥",label:"Total Santri",val:dbStatus==="ok"?`${santriDB.length}`:"..."},{icon:"⚡",label:"Durasi Sesi",val:"15 Menit"},{icon:"📤",label:"Rekap",val:"WA + Sheets"}].map((s,i)=>(
                <div key={i} style={{...card,padding:"12px 8px",textAlign:"center"}}>
                  <div style={{fontSize:18,marginBottom:2}}>{s.icon}</div>
                  <div style={{fontSize:15,fontWeight:700,color:"#f8fafc"}}>{s.val}</div>
                  <div style={{fontSize:9,color:"#64748b"}}>{s.label}</div>
                </div>
              ))}
            </div>

            <button onClick={()=>setScreen("setup")} disabled={dbStatus!=="ok"} style={{width:"100%",padding:"14px",background:dbStatus==="ok"?"linear-gradient(135deg,#22c55e,#16a34a)":"rgba(255,255,255,0.05)",border:"none",borderRadius:12,color:dbStatus==="ok"?"#fff":"#475569",fontSize:14,fontWeight:700,cursor:dbStatus==="ok"?"pointer":"not-allowed",boxShadow:dbStatus==="ok"?"0 6px 20px rgba(34,197,94,0.3)":"none",marginBottom:9}}>
              🚀 Mulai Sesi Absensi
            </button>
            <button onClick={()=>setScreen("tahunan")} style={{width:"100%",padding:"14px",background:"linear-gradient(135deg,#6366f1,#4f46e5)",border:"none",borderRadius:12,color:"#fff",fontSize:14,fontWeight:700,cursor:"pointer",boxShadow:"0 6px 20px rgba(99,102,241,0.3)",marginBottom:12}}>
              📊 Rekap Tahunan Per Santri
            </button>
            <div style={{padding:11,background:"rgba(59,130,246,0.08)",border:"1px solid rgba(59,130,246,0.2)",borderRadius:10}}>
              <div style={{fontSize:11,color:"#93c5fd"}}>💡 <strong>Baru!</strong> Absensi kini bisa per <strong>Rayon</strong>, <strong>Kamar</strong>, atau <strong>Kelas</strong> — tidak harus semua santri sekaligus.</div>
            </div>
          </div>
        )}

        {/* ══ SETUP ══ */}
        {screen==="setup" && (
          <div>
            <h2 style={{fontSize:17,fontWeight:700,marginBottom:16,color:"#f8fafc"}}>⚙️ Pengaturan Sesi Absensi</h2>

            {/* STEP 1: Pilih Kegiatan */}
            <div style={{...card,padding:14,marginBottom:12}}>
              <div style={{fontSize:12,fontWeight:700,color:"#94a3b8",marginBottom:10,textTransform:"uppercase",letterSpacing:1}}>① Pilih Kegiatan</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginBottom:10}}>
                {KEGIATAN.map(k=>(
                  <button key={k} onClick={()=>setKegiatan(k)} style={{padding:"10px 12px",borderRadius:8,cursor:"pointer",fontSize:12,background:kegiatan===k?"linear-gradient(135deg,#22c55e,#16a34a)":"rgba(255,255,255,0.04)",border:kegiatan===k?"2px solid #22c55e":"1px solid rgba(255,255,255,0.08)",color:kegiatan===k?"#fff":"#cbd5e1",fontWeight:kegiatan===k?700:400}}>
                    {k}
                  </button>
                ))}
              </div>
              <input type="text" placeholder="Atau ketik kegiatan lain..."
                value={KEGIATAN.includes(kegiatan)?"":kegiatan} onChange={e=>setKegiatan(e.target.value)}
                style={{...select}}/>
            </div>

            {/* STEP 2: Pilih Cakupan */}
            <div style={{...card,padding:14,marginBottom:12}}>
              <div style={{fontSize:12,fontWeight:700,color:"#94a3b8",marginBottom:10,textTransform:"uppercase",letterSpacing:1}}>② Pilih Cakupan Absensi</div>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginBottom:12}}>
                {[
                  {val:"semua",icon:"👥",label:"Semua Santri"},
                  {val:"rayon",icon:"🏠",label:"Per Rayon"},
                  {val:"kamar",icon:"🚪",label:"Per Kamar"},
                  {val:"kelas",icon:"📚",label:"Per Kelas"},
                ].map(opt=>(
                  <button key={opt.val} onClick={()=>{setFilterMode(opt.val);setFilterRayon("");setFilterKamar("");setFilterKelas("");}} style={{
                    padding:"12px 10px",borderRadius:10,cursor:"pointer",textAlign:"center",
                    background:filterMode===opt.val?"linear-gradient(135deg,#6366f1,#4f46e5)":"rgba(255,255,255,0.04)",
                    border:filterMode===opt.val?"2px solid #6366f1":"1px solid rgba(255,255,255,0.08)",
                    color:filterMode===opt.val?"#fff":"#cbd5e1",
                  }}>
                    <div style={{fontSize:20,marginBottom:3}}>{opt.icon}</div>
                    <div style={{fontSize:12,fontWeight:filterMode===opt.val?700:400}}>{opt.label}</div>
                  </button>
                ))}
              </div>

              {/* Sub-filter Rayon */}
              {(filterMode==="rayon"||filterMode==="kamar") && (
                <div style={{marginBottom:8}}>
                  <label style={{fontSize:11,color:"#64748b",display:"block",marginBottom:5}}>Pilih Rayon</label>
                  <select value={filterRayon} onChange={e=>{setFilterRayon(e.target.value);setFilterKamar("");}} style={select}>
                    <option value="" style={{background:"#1e293b"}}>-- Pilih Rayon --</option>
                    {SEMUA_RAYON.map(r=><option key={r} value={r} style={{background:"#1e293b"}}>{r}</option>)}
                  </select>
                </div>
              )}

              {/* Sub-filter Kamar */}
              {filterMode==="kamar" && filterRayon && (
                <div style={{marginBottom:8}}>
                  <label style={{fontSize:11,color:"#64748b",display:"block",marginBottom:5}}>Pilih Kamar</label>
                  <select value={filterKamar} onChange={e=>setFilterKamar(e.target.value)} style={select}>
                    <option value="" style={{background:"#1e293b"}}>-- Pilih Kamar --</option>
                    {(RAYON_KAMAR[filterRayon]||[]).map(k=>(
                      <option key={k} value={String(k)} style={{background:"#1e293b"}}>
                        Kamar {k} {santriDB.filter(s=>s.rayon===filterRayon&&String(s.kamar)===String(k)).length > 0 ? `(${santriDB.filter(s=>s.rayon===filterRayon&&String(s.kamar)===String(k)).length} santri)` : ""}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Sub-filter Kelas */}
              {filterMode==="kelas" && (
                <div style={{marginBottom:8}}>
                  <label style={{fontSize:11,color:"#64748b",display:"block",marginBottom:5}}>Pilih Kelas</label>
                  <div style={{display:"grid",gridTemplateColumns:"repeat(6,1fr)",gap:5}}>
                    {SEMUA_KELAS.map(k=>(
                      <button key={k} onClick={()=>setFilterKelas(k)} style={{
                        padding:"7px 4px",borderRadius:7,cursor:"pointer",fontSize:10,textAlign:"center",
                        background:filterKelas===k?"linear-gradient(135deg,#6366f1,#4f46e5)":"rgba(255,255,255,0.04)",
                        border:filterKelas===k?"1px solid #6366f1":"1px solid rgba(255,255,255,0.08)",
                        color:filterKelas===k?"#fff":"#cbd5e1",fontWeight:filterKelas===k?700:400,
                      }}>
                        {k.replace("Kelas ","")}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Preview jumlah santri */}
              {canStart() && (
                <div style={{marginTop:10,padding:"8px 12px",background:"rgba(99,102,241,0.1)",border:"1px solid rgba(99,102,241,0.2)",borderRadius:8,fontSize:12,color:"#a5b4fc"}}>
                  👥 <strong>{santriSesi().length} santri</strong> akan diabsen — {labelSesi()}
                </div>
              )}
            </div>

            {/* Tombol Mulai */}
            <button onClick={startSesi} disabled={!canStart()} style={{
              width:"100%",padding:"14px",border:"none",borderRadius:11,
              background:canStart()?"linear-gradient(135deg,#22c55e,#16a34a)":"rgba(255,255,255,0.05)",
              color:canStart()?"#fff":"#475569",fontSize:14,fontWeight:700,cursor:canStart()?"pointer":"not-allowed",
              boxShadow:canStart()?"0 4px 16px rgba(34,197,94,0.3)":"none",
            }}>
              {canStart() ? `▶ Mulai Absensi — ${kegiatan} (${labelSesi()})` : "Lengkapi pilihan di atas"}
            </button>
          </div>
        )}

        {/* ══ SESI ══ */}
        {screen==="sesi" && (
          <div>
            {/* Timer */}
            <div style={{textAlign:"center",marginBottom:14}}>
              <div style={{fontSize:10,color:"#64748b",marginBottom:1,letterSpacing:1,textTransform:"uppercase"}}>{kegiatan}</div>
              <div style={{fontSize:11,color:"#6366f1",marginBottom:3,fontWeight:600}}>{labelSesi()}</div>
              <div style={{position:"relative",display:"inline-block"}}>
                <svg width="110" height="110" style={{transform:"rotate(-90deg)"}}>
                  <circle cx="55" cy="55" r="48" fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="6"/>
                  <circle cx="55" cy="55" r="48" fill="none" stroke={timerColor} strokeWidth="6"
                    strokeDasharray={`${2*Math.PI*48}`} strokeDashoffset={`${2*Math.PI*48*(1-timerPct/100)}`}
                    strokeLinecap="round" style={{transition:"stroke-dashoffset 1s linear,stroke 0.5s"}}/>
                </svg>
                <div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center"}}>
                  <div style={{fontSize:22,fontWeight:800,color:timerColor,fontVariantNumeric:"tabular-nums"}}>{fmt(timer)}</div>
                  <div style={{fontSize:9,color:"#64748b"}}>tersisa</div>
                </div>
              </div>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:12}}>
              {[{val:totalHadir,label:"Hadir",color:"#4ade80"},{val:alphaList.length,label:"Belum",color:"#f87171"},{val:`${persen}%`,label:"Kehadiran",color:"#60a5fa"}].map((s,i)=>(
                <div key={i} style={{...card,padding:"8px 4px",textAlign:"center"}}>
                  <div style={{fontSize:17,fontWeight:800,color:s.color}}>{s.val}</div>
                  <div style={{fontSize:9,color:"#64748b"}}>{s.label}</div>
                </div>
              ))}
            </div>

            {/* Kamera */}
            <div style={{...card,padding:12,marginBottom:10}}>
              <div style={{fontSize:11,color:"#94a3b8",marginBottom:7,fontWeight:600}}>📷 Kamera QR Scanner</div>
              <QRScanner onDetected={prosesKode}/>
              {lastScan && (
                <div style={{marginTop:7,padding:"8px 11px",borderRadius:8,fontSize:12,background:flash==="ok"?"rgba(34,197,94,0.12)":flash==="dup"?"rgba(250,204,21,0.12)":"rgba(248,113,113,0.12)",border:`1px solid ${flash==="ok"?"rgba(34,197,94,0.35)":flash==="dup"?"rgba(250,204,21,0.35)":"rgba(248,113,113,0.35)"}`}}>
                  <strong>{lastScan.nama}</strong> — {lastScan.status}
                </div>
              )}
              <details style={{marginTop:9}}>
                <summary style={{fontSize:11,color:"#64748b",cursor:"pointer",userSelect:"none",listStyle:"none"}}>✏️ Input kode manual (backup)</summary>
                <div style={{marginTop:7,display:"flex",gap:6}}>
                  <input ref={inputRef} type="text" value={scanInput} onChange={e=>setScanInput(e.target.value)} onKeyDown={handleManualInput}
                    placeholder="Ketik kode QR lalu Enter..."
                    style={{flex:1,padding:"8px 10px",borderRadius:7,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.12)",color:"#f8fafc",fontSize:12}}/>
                  <button onClick={()=>{if(scanInput.trim()){prosesKode(scanInput.trim().toUpperCase());setScanInput("");}}} style={{padding:"8px 12px",borderRadius:7,background:"rgba(99,102,241,0.2)",border:"1px solid rgba(99,102,241,0.3)",color:"#a5b4fc",fontSize:12,cursor:"pointer"}}>OK</button>
                </div>
                <button onClick={simulateScan} style={{marginTop:5,width:"100%",padding:"7px",background:"rgba(99,102,241,0.08)",border:"1px solid rgba(99,102,241,0.15)",borderRadius:7,color:"#818cf8",fontSize:11,cursor:"pointer"}}>🎲 Simulasi Scan (Demo)</button>
              </details>
            </div>

            {/* Log */}
            {logs.length > 0 && (
              <div style={{...card,overflow:"hidden",marginBottom:10}}>
                <div style={{padding:"6px 11px",borderBottom:"1px solid rgba(255,255,255,0.06)",fontSize:10,color:"#64748b",textTransform:"uppercase",letterSpacing:1}}>Log ({logs.length} santri)</div>
                <div style={{maxHeight:130,overflowY:"auto"}}>
                  {logs.slice(0,8).map((l,i)=>(
                    <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 11px",borderBottom:"1px solid rgba(255,255,255,0.03)",fontSize:11}}>
                      <span><strong style={{color:"#f8fafc"}}>{l.nama}</strong> <span style={{color:"#64748b"}}>Km.{l.kamar}</span></span>
                      <span style={{color:"#4ade80"}}>✅ {l.waktu}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <button onClick={()=>{clearInterval(intervalRef.current);setScreen("recap");}} style={{width:"100%",padding:"11px",background:"rgba(239,68,68,0.15)",border:"1px solid rgba(239,68,68,0.3)",borderRadius:10,color:"#f87171",fontSize:13,fontWeight:700,cursor:"pointer"}}>
              ⏹ Tutup Sesi & Lihat Rekap
            </button>
          </div>
        )}

        {/* ══ RECAP SESI ══ */}
        {screen==="recap" && (
          <div>
            <div style={{textAlign:"center",marginBottom:18}}>
              <div style={{fontSize:38,marginBottom:4}}>📊</div>
              <h2 style={{fontSize:18,fontWeight:800,color:"#f8fafc",margin:"0 0 2px"}}>Rekap Sesi</h2>
              <div style={{color:"#6366f1",fontSize:12,fontWeight:600}}>{labelSesi()}</div>
              <div style={{color:"#64748b",fontSize:10,marginTop:2}}>{kegiatan} — {todayStr()}</div>
            </div>

            <div style={{background:"linear-gradient(135deg,rgba(34,197,94,0.1),rgba(16,185,129,0.05))",border:"1px solid rgba(34,197,94,0.2)",borderRadius:12,padding:14,marginBottom:10}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:8,marginBottom:10}}>
                {[{label:"Target",val:totalTarget,color:"#f8fafc"},{label:"Hadir",val:totalHadir,color:"#4ade80"},{label:"Alpha",val:alphaList.length,color:"#f87171"},{label:"Persen",val:`${persen}%`,color:"#60a5fa"}].map((s,i)=>(
                  <div key={i} style={{textAlign:"center"}}>
                    <div style={{fontSize:19,fontWeight:800,color:s.color}}>{s.val}</div>
                    <div style={{fontSize:9,color:"#64748b"}}>{s.label}</div>
                  </div>
                ))}
              </div>
              <div style={{height:5,background:"rgba(255,255,255,0.08)",borderRadius:3,overflow:"hidden"}}>
                <div style={{height:"100%",borderRadius:3,background:"linear-gradient(90deg,#22c55e,#4ade80)",width:`${persen}%`,transition:"width 1s ease"}}/>
              </div>
            </div>

            <button onClick={simpanKeRekap} style={{width:"100%",padding:"13px",marginBottom:5,background:"linear-gradient(135deg,#6366f1,#4f46e5)",border:"none",borderRadius:10,color:"#fff",fontSize:13,fontWeight:700,cursor:"pointer",boxShadow:"0 4px 14px rgba(99,102,241,0.35)"}}>
              💾 Simpan ke Rekap Tahunan
            </button>
            <div style={{fontSize:10,color:"#64748b",textAlign:"center",marginBottom:10}}>↑ Klik ini agar data tersimpan permanen</div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:8}}>
              <button onClick={generateWA} style={{padding:"11px",borderRadius:9,cursor:"pointer",background:"linear-gradient(135deg,#25D366,#128C7E)",border:"none",color:"#fff",fontSize:12,fontWeight:700}}>📲 WhatsApp</button>
              <button onClick={downloadCSV} style={{padding:"11px",borderRadius:9,cursor:"pointer",background:"linear-gradient(135deg,#34a853,#0f9d58)",border:"none",color:"#fff",fontSize:12,fontWeight:700}}>📊 Export Sheets</button>
            </div>

            <button onClick={()=>setScreen("tahunan")} style={{width:"100%",padding:"10px",marginBottom:6,background:"rgba(99,102,241,0.1)",border:"1px solid rgba(99,102,241,0.3)",borderRadius:9,color:"#a5b4fc",fontSize:12,fontWeight:600,cursor:"pointer"}}>📊 Lihat Rekap Tahunan →</button>
            <button onClick={()=>{setScreen("home");setKegiatan("");setFilterMode("semua");setFilterRayon("");setFilterKamar("");setFilterKelas("");}} style={{width:"100%",padding:"9px",background:"rgba(255,255,255,0.04)",border:"1px solid rgba(255,255,255,0.08)",borderRadius:9,color:"#94a3b8",fontSize:12,cursor:"pointer"}}>🔄 Sesi Baru</button>
          </div>
        )}

        {/* ══ REKAP TAHUNAN ══ */}
        {screen==="tahunan" && !selectedSantri && (
          <div>
            <div style={{marginBottom:14}}>
              <h2 style={{fontSize:17,fontWeight:800,color:"#f8fafc",margin:"0 0 2px"}}>📊 Rekap Tahunan Per Santri</h2>
              <div style={{fontSize:10,color:"#64748b"}}>Tahun {thisYear()} — {santriDB.length} santri</div>
            </div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:7,marginBottom:8}}>
              <input type="text" placeholder="🔍 Cari nama / ID / kamar / kelas..."
                value={searchQuery} onChange={e=>setSearchQuery(e.target.value)}
                style={{gridColumn:"1 / -1",padding:"8px 11px",borderRadius:9,background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",color:"#f8fafc",fontSize:12,boxSizing:"border-box"}}/>
              <select value={rekapFilterKamar} onChange={e=>setRekapFilterKamar(e.target.value)} style={{...select,fontSize:11}}>
                {kamarListRekap.map(k=><option key={k} value={k} style={{background:"#1e293b"}}>{k}</option>)}
              </select>
              <select value={rekapFilterKegiatan} onChange={e=>setRekapFilterKegiatan(e.target.value)} style={{...select,fontSize:11}}>
                {kegiatanListRekap.map(k=><option key={k} value={k} style={{background:"#1e293b"}}>{k}</option>)}
              </select>
            </div>

            <div style={{display:"flex",gap:5,marginBottom:9,flexWrap:"wrap"}}>
              <span style={{fontSize:10,color:"#64748b",alignSelf:"center"}}>Urut:</span>
              {[["nama","A-Z"],["hadir","Hadir ↓"],["alpha","Alpha ↓"],["persen","% ↓"]].map(([val,label])=>(
                <button key={val} onClick={()=>setSortBy(val)} style={{padding:"3px 9px",borderRadius:20,cursor:"pointer",fontSize:10,background:sortBy===val?"rgba(99,102,241,0.3)":"rgba(255,255,255,0.05)",border:sortBy===val?"1px solid rgba(99,102,241,0.5)":"1px solid rgba(255,255,255,0.08)",color:sortBy===val?"#a5b4fc":"#64748b"}}>{label}</button>
              ))}
            </div>

            {(()=>{
              const tH=santriFiltered.reduce((a,s)=>a+s.stat.totalH,0);
              const tA=santriFiltered.reduce((a,s)=>a+s.stat.totalA,0);
              return (
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:6,marginBottom:10}}>
                  {[{icon:"✅",label:"Total Hadir",val:tH,color:"#4ade80"},{icon:"❌",label:"Total Alpha",val:tA,color:"#f87171"},{icon:"📋",label:"Total Sesi",val:tH+tA,color:"#60a5fa"}].map((s,i)=>(
                    <div key={i} style={{...card,padding:"8px 6px",textAlign:"center"}}>
                      <div style={{fontSize:16,fontWeight:800,color:s.color}}>{s.val}</div>
                      <div style={{fontSize:9,color:"#64748b"}}>{s.icon} {s.label}</div>
                    </div>
                  ))}
                </div>
              );
            })()}

            <div style={{...card,overflow:"hidden",marginBottom:10}}>
              <div style={{display:"grid",gridTemplateColumns:"1fr 50px 50px 50px 44px",padding:"7px 11px",borderBottom:"1px solid rgba(255,255,255,0.08)",background:"rgba(255,255,255,0.03)"}}>
                {["Nama Santri","Hadir","Alpha","Sesi","%"].map((h,i)=>(
                  <div key={i} style={{fontSize:9,color:"#64748b",textTransform:"uppercase",letterSpacing:0.5,textAlign:i>0?"center":"left"}}>{h}</div>
                ))}
              </div>
              <div style={{maxHeight:340,overflowY:"auto"}}>
                {santriFiltered.length===0 ? (
                  <div style={{padding:20,textAlign:"center",color:"#64748b",fontSize:12}}>Tidak ada data</div>
                ) : santriFiltered.map((s,i)=>{
                  const pc=s.stat.persen;
                  const pcColor=pc>=80?"#4ade80":pc>=60?"#facc15":pc>0?"#f87171":"#475569";
                  return (
                    <div key={i} onClick={()=>setSelectedSantri(s)}
                      style={{display:"grid",gridTemplateColumns:"1fr 50px 50px 50px 44px",padding:"8px 11px",borderBottom:"1px solid rgba(255,255,255,0.04)",cursor:"pointer"}}
                      onMouseEnter={e=>e.currentTarget.style.background="rgba(255,255,255,0.04)"}
                      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                      <div>
                        <div style={{fontSize:12,color:"#f8fafc",fontWeight:600}}>{s.nama}</div>
                        <div style={{fontSize:9,color:"#64748b"}}>{s.rayon} · Km.{s.kamar} · {s.kelas}</div>
                      </div>
                      <div style={{textAlign:"center",fontSize:13,color:"#4ade80",fontWeight:700,alignSelf:"center"}}>{s.stat.totalH}</div>
                      <div style={{textAlign:"center",fontSize:13,color:"#f87171",fontWeight:700,alignSelf:"center"}}>{s.stat.totalA}</div>
                      <div style={{textAlign:"center",fontSize:11,color:"#94a3b8",alignSelf:"center"}}>{s.stat.total}</div>
                      <div style={{textAlign:"center",fontSize:11,color:pcColor,fontWeight:700,alignSelf:"center"}}>{s.stat.total>0?`${pc}%`:"-"}</div>
                    </div>
                  );
                })}
              </div>
            </div>
            <button onClick={downloadCSVTahunan} style={{width:"100%",padding:"11px",background:"linear-gradient(135deg,#34a853,#0f9d58)",border:"none",borderRadius:10,color:"#fff",fontSize:12,fontWeight:700,cursor:"pointer"}}>
              📥 Export Rekap Tahunan → Excel / Sheets
            </button>
          </div>
        )}

        {/* ══ DETAIL SANTRI ══ */}
        {screen==="tahunan" && selectedSantri && (()=>{
          const tahun=thisYear();
          const data=rekapTahunan[selectedSantri.id]?.[tahun]||{};
          const stat=getStatSantri(selectedSantri.id,tahun,rekapFilterKegiatan);
          return (
            <div>
              <button onClick={()=>setSelectedSantri(null)} style={{background:"rgba(255,255,255,0.06)",border:"1px solid rgba(255,255,255,0.1)",borderRadius:8,color:"#94a3b8",padding:"5px 11px",cursor:"pointer",fontSize:11,marginBottom:12}}>← Kembali</button>
              <div style={{...card,padding:14,marginBottom:12}}>
                <div style={{display:"flex",alignItems:"center",gap:11,marginBottom:12}}>
                  <div style={{width:44,height:44,borderRadius:"50%",background:"linear-gradient(135deg,#6366f1,#4f46e5)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,color:"#fff",fontWeight:800,flexShrink:0}}>
                    {selectedSantri.nama.charAt(0)}
                  </div>
                  <div>
                    <div style={{fontSize:15,fontWeight:800,color:"#f8fafc"}}>{selectedSantri.nama}</div>
                    <div style={{fontSize:10,color:"#64748b"}}>{selectedSantri.rayon} · Kamar {selectedSantri.kamar} · {selectedSantri.kelas}</div>
                    <div style={{fontSize:10,color:"#64748b"}}>ID: {selectedSantri.id} · Rekap Tahun {tahun}</div>
                  </div>
                </div>
                <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr 1fr",gap:7,marginBottom:10}}>
                  {[{label:"Total Sesi",val:stat.total,color:"#94a3b8"},{label:"Hadir",val:stat.totalH,color:"#4ade80"},{label:"Alpha",val:stat.totalA,color:"#f87171"},{label:"Kehadiran",val:stat.total>0?`${stat.persen}%`:"-",color:stat.persen>=80?"#4ade80":stat.persen>=60?"#facc15":"#f87171"}].map((s,i)=>(
                    <div key={i} style={{textAlign:"center",background:"rgba(255,255,255,0.05)",borderRadius:8,padding:"8px 4px"}}>
                      <div style={{fontSize:17,fontWeight:800,color:s.color}}>{s.val}</div>
                      <div style={{fontSize:9,color:"#64748b"}}>{s.label}</div>
                    </div>
                  ))}
                </div>
                {stat.total>0 && (
                  <div>
                    <div style={{height:6,background:"rgba(255,255,255,0.08)",borderRadius:3,overflow:"hidden"}}>
                      <div style={{height:"100%",borderRadius:3,width:`${stat.persen}%`,background:stat.persen>=80?"linear-gradient(90deg,#22c55e,#4ade80)":stat.persen>=60?"linear-gradient(90deg,#f59e0b,#facc15)":"linear-gradient(90deg,#ef4444,#f87171)"}}/>
                    </div>
                    <div style={{fontSize:9,color:"#64748b",marginTop:2,textAlign:"right"}}>{stat.totalH}x hadir dari {stat.total}x sesi</div>
                  </div>
                )}
              </div>

              {Object.keys(data).length>0 ? (
                <div style={{...card,overflow:"hidden",marginBottom:10}}>
                  <div style={{padding:"8px 12px",borderBottom:"1px solid rgba(255,255,255,0.07)",fontSize:11,color:"#94a3b8",fontWeight:600}}>📌 Rincian Per Kegiatan</div>
                  {Object.entries(data).map(([kg,val],i)=>{
                    const tot=val.hadir+val.alpha;
                    const pc=tot>0?Math.round(val.hadir/tot*100):0;
                    return (
                      <div key={i} style={{padding:"10px 12px",borderBottom:"1px solid rgba(255,255,255,0.04)"}}>
                        <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                          <span style={{fontSize:12,color:"#f8fafc",fontWeight:600}}>{kg}</span>
                          <span style={{fontSize:12,color:pc>=80?"#4ade80":pc>=60?"#facc15":"#f87171",fontWeight:700}}>{pc}%</span>
                        </div>
                        <div style={{display:"flex",gap:12,marginBottom:4}}>
                          <span style={{fontSize:11,color:"#4ade80"}}>✅ {val.hadir}x hadir</span>
                          <span style={{fontSize:11,color:"#f87171"}}>❌ {val.alpha}x alpha</span>
                          <span style={{fontSize:11,color:"#64748b"}}>Total {tot}x</span>
                        </div>
                        <div style={{height:3,background:"rgba(255,255,255,0.06)",borderRadius:2,overflow:"hidden"}}>
                          <div style={{height:"100%",borderRadius:2,width:`${pc}%`,background:pc>=80?"#22c55e":pc>=60?"#f59e0b":"#ef4444"}}/>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{...card,padding:18,textAlign:"center",marginBottom:10}}>
                  <div style={{fontSize:26,marginBottom:6}}>📭</div>
                  <div style={{color:"#64748b",fontSize:12}}>Belum ada data absensi untuk santri ini.</div>
                </div>
              )}

              {Object.values(data).some(v=>v.riwayat?.length>0) && (
                <div style={{...card,overflow:"hidden"}}>
                  <div style={{padding:"8px 12px",borderBottom:"1px solid rgba(255,255,255,0.07)",fontSize:11,color:"#94a3b8",fontWeight:600}}>🕐 Riwayat Sesi Terakhir</div>
                  <div style={{maxHeight:180,overflowY:"auto"}}>
                    {Object.entries(data).flatMap(([kg,val])=>(val.riwayat||[]).map(r=>({...r,kg}))).slice(-15).reverse().map((r,i)=>(
                      <div key={i} style={{display:"flex",justifyContent:"space-between",padding:"6px 12px",borderBottom:"1px solid rgba(255,255,255,0.03)",fontSize:11}}>
                        <div><span style={{color:"#f8fafc"}}>{r.kg}</span><span style={{color:"#64748b",marginLeft:5}}>{r.tanggal}</span></div>
                        <span style={{color:r.status==="hadir"?"#4ade80":"#f87171",fontWeight:600}}>{r.status==="hadir"?`✅ ${r.waktu}`:"❌ Alpha"}</span>
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

"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import {
  addMonths,
  eachDayOfInterval,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns";
import { th } from "date-fns/locale";
import {
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  CircleUserRound,
  Clock3,
  LoaderCircle,
  LogOut,
  ImagePlus,
  PencilLine,
  Search,
  Trash2,
  X,
} from "lucide-react";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/client";

const demoMembers = ["Ari", "Mina", "Jay", "Noah", "Lina", "Chen"];
const initials: Record<string, string> = { Ari: "AR", Mina: "MI", Jay: "JA", Noah: "NO", Lina: "LI", Chen: "CH" };
const getInitials = (name: string) => initials[name] ?? (name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "CM");
const sharedTeamId = process.env.NEXT_PUBLIC_DEFAULT_TEAM_ID ?? "00000000-0000-4000-8000-000000000001";
const usernameDomain = "calendar-maew.local";
const reasons = ["ติดงาน", "ลาพักร้อน", "ประชุม", "เดินทาง", "ธุระส่วนตัว"];

type Status = "available" | "busy";
type AvailabilityRecord = { date: string; member: string; status: Status; reason: string };
type MemberProfile = { id: string; name: string; avatarUrl: string | null };

const seedData: AvailabilityRecord[] = [
  ...demoMembers.map((member) => ({ date: "2026-07-10", member, status: "available" as Status, reason: "" })),
  { date: "2026-07-12", member: "Ari", status: "busy", reason: "ประชุม" },
  { date: "2026-07-12", member: "Noah", status: "busy", reason: "ติดงาน" },
  { date: "2026-07-15", member: "Mina", status: "busy", reason: "ลาพักร้อน" },
  { date: "2026-07-18", member: "Chen", status: "busy", reason: "เดินทาง" },
];

export default function Home() {
  const [currentMonth, setCurrentMonth] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [view, setView] = useState<"calendar" | "team">("calendar");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [memberProfiles, setMemberProfiles] = useState<MemberProfile[]>(
    demoMembers.map((name) => ({ id: name, name, avatarUrl: null })),
  );
  const profileMap = useMemo(() => Object.fromEntries(memberProfiles.map((profile) => [profile.name, profile])), [memberProfiles]);
  const members = memberProfiles.map((member) => member.name);
  const [selectedMember, setSelectedMember] = useState(demoMembers[0]);
  const [selectedStatus, setSelectedStatus] = useState<Status>("available");
  const [selectedReason, setSelectedReason] = useState("");
  const [records, setRecords] = useState(() => isSupabaseConfigured() ? [] : seedData);
  const [isDataLoading, setIsDataLoading] = useState(isSupabaseConfigured());
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(!isSupabaseConfigured());
  const [isSaving, setIsSaving] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const [memberQuery, setMemberQuery] = useState("");
  const [selectedDates, setSelectedDates] = useState<string[]>([]);
  const [isMultiSelect, setIsMultiSelect] = useState(false);
  const [isAvatarUploading, setIsAvatarUploading] = useState(false);
  const [noticeTimer, setNoticeTimer] = useState<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      setUser(data.user);
      setAuthReady(true);
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null));
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!user || !isSupabaseConfigured()) return;
    const supabase = createClient();
    const loadData = async () => {
      setIsDataLoading(true);
      const monthStart = format(startOfMonth(currentMonth), "yyyy-MM-dd");
      const monthEnd = format(endOfMonth(currentMonth), "yyyy-MM-dd");
      const [{ data: memberships }, { data: availability }] = await Promise.all([
        supabase.from("team_members").select("user_id, profiles(display_name, avatar_url)").eq("team_id", sharedTeamId),
        supabase.from("availability").select("date, user_id, status, reason").eq("team_id", sharedTeamId).gte("date", monthStart).lte("date", monthEnd),
      ]);
      const profiles = (memberships ?? []).map((membership) => {
        const profile = Array.isArray(membership.profiles) ? membership.profiles[0] : membership.profiles;
        return { id: membership.user_id, name: profile?.display_name ?? "สมาชิก", avatarUrl: profile?.avatar_url ?? null };
      });
      setMemberProfiles(profiles);
      const currentName = profiles.find((profile) => profile.id === user.id)?.name;
      if (currentName) setSelectedMember(currentName);
      setRecords((availability ?? []).map((record) => ({
        date: record.date,
        member: profiles.find((profile) => profile.id === record.user_id)?.name ?? "สมาชิก",
        status: record.status as Status,
        reason: record.reason,
      })));
      setIsDataLoading(false);
    };
    void loadData();
    const channel = supabase.channel("shared-availability").on(
      "postgres_changes",
      { event: "*", schema: "public", table: "availability", filter: `team_id=eq.${sharedTeamId}` },
      loadData,
    ).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [user, currentMonth]);

  useEffect(() => {
    if (!isModalOpen) return;
    const handleKey = (event: KeyboardEvent) => event.key === "Escape" && setIsModalOpen(false);
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isModalOpen]);

  useEffect(() => () => { if (noticeTimer) clearTimeout(noticeTimer); }, [noticeTimer]);

  const days = useMemo(() => {
    const start = startOfWeek(startOfMonth(currentMonth), { weekStartsOn: 1 });
    const end = endOfWeek(endOfMonth(currentMonth), { weekStartsOn: 1 });
    return eachDayOfInterval({ start, end });
  }, [currentMonth]);

  const getDayRecords = (day: Date) => {
    const key = format(day, "yyyy-MM-dd");
    return members.map((member) => records.find((record) => record.date === key && record.member === member) ?? null);
  };

  const bestDays = useMemo(() => {
    const totalMembers = members.length;
    return days
      .map((day) => {
        const key = format(day, "yyyy-MM-dd");
        const dayRecords = records.filter((record) => record.date === key);
        const available = dayRecords.filter((record) => record.status === "available").length;
        const busy = dayRecords.filter((record) => record.status === "busy").length;
        const unresolved = Math.max(totalMembers - dayRecords.length, 0);
        return { day, key, available, busy, unresolved, score: available - busy - unresolved };
      })
      .filter((item) => item.available > 0)
      .sort((left, right) => right.score - left.score || right.available - left.available || left.unresolved - right.unresolved)
      .slice(0, 5);
  }, [days, members.length, records]);

  const selectedRecords = getDayRecords(selectedDate);
  const availableCount = selectedRecords.filter((record) => record?.status === "available").length;
  const responseCount = selectedRecords.filter(Boolean).length;

  const openEditor = (day: Date) => {
    setSelectedDate(day);
    const existing = records.find(
      (record) => record.date === format(day, "yyyy-MM-dd") && record.member === selectedMember,
    );
    setSelectedStatus(existing?.status ?? "available");
    setSelectedReason(existing?.reason ?? "");
    setIsModalOpen(true);
  };

  const clearNoticeLater = (message: { tone: "success" | "error"; message: string }) => {
    setNotice(message);
    if (noticeTimer) clearTimeout(noticeTimer);
    setNoticeTimer(setTimeout(() => setNotice(null), 3200));
  };

  const submitAvailability = async () => {
    const keys = selectedDates.length ? selectedDates : [format(selectedDate, "yyyy-MM-dd")];
    setIsSaving(true);
    setNotice(null);

    try {
      if (isSupabaseConfigured() && user) {
        const { error } = await createClient().from("availability").upsert(
          keys.map((date) => ({ team_id: sharedTeamId, user_id: user.id, date, status: selectedStatus, reason: selectedReason })),
          { onConflict: "team_id,user_id,date" },
        );
        if (error) throw error;
        const ownName = memberProfiles.find((profile) => profile.id === user.id)?.name ?? selectedMember;
        setRecords((previous) => [
          ...previous.filter((record) => !(keys.includes(record.date) && record.member === ownName)),
          ...keys.map((date) => ({ date, member: ownName, status: selectedStatus, reason: selectedReason })),
        ]);
      } else {
        setRecords((previous) => [
          ...previous.filter((record) => !(keys.includes(record.date) && record.member === selectedMember)),
          ...keys.map((date) => ({ date, member: selectedMember, status: selectedStatus, reason: selectedReason })),
        ]);
      }
      clearNoticeLater({ tone: "success", message: `บันทึกสถานะ ${keys.length} วันเรียบร้อยแล้ว` });
      setSelectedDates([]);
      setIsMultiSelect(false);
      setIsModalOpen(false);
    } catch (error) {
      clearNoticeLater({ tone: "error", message: error instanceof Error ? error.message : "บันทึกไม่สำเร็จ กรุณาลองใหม่" });
    } finally {
      setIsSaving(false);
    }
  };

  const uploadAvatar = async (file: File) => {
    if (!user || !isSupabaseConfigured()) return;
    if (!file.type.match(/^image\/(jpeg|png|webp)$/) || file.size > 2 * 1024 * 1024) {
      setNotice({ tone: "error", message: "รองรับ JPG, PNG หรือ WebP ขนาดไม่เกิน 2 MB" });
      return;
    }
    setIsAvatarUploading(true);
    const supabase = createClient();
    const extension = file.type.split("/")[1].replace("jpeg", "jpg");
    const path = `${user.id}/avatar.${extension}`;
    const { error: uploadError } = await supabase.storage.from("avatars").upload(path, file, { upsert: true, contentType: file.type });
    if (uploadError) {
      clearNoticeLater({ tone: "error", message: `อัปโหลดรูปไม่สำเร็จ: ${uploadError.message}` });
      setIsAvatarUploading(false);
      return;
    }
    const { data } = supabase.storage.from("avatars").getPublicUrl(path);
    const avatarUrl = `${data.publicUrl}?v=${Date.now()}`;
    const { error: profileError } = await supabase.from("profiles").update({ avatar_url: avatarUrl }).eq("id", user.id);
    if (profileError) clearNoticeLater({ tone: "error", message: "บันทึกรูปโปรไฟล์ไม่สำเร็จ" });
    else {
      setMemberProfiles((profiles) => profiles.map((profile) => profile.id === user.id ? { ...profile, avatarUrl } : profile));
      clearNoticeLater({ tone: "success", message: "อัปเดตรูปโปรไฟล์แล้ว" });
    }
    setIsAvatarUploading(false);
  };

  if (!authReady) {
    return <div className="grid min-h-dvh place-items-center bg-[#f2f0e9]"><LoaderCircle className="size-6 animate-spin text-[#245c4a]" aria-label="กำลังโหลด" /></div>;
  }

  if (isSupabaseConfigured() && !user) return <AuthScreen />;

  const visibleMembers = members.filter((member) => member.toLowerCase().includes(memberQuery.toLowerCase()));

  return (
    <main className="min-h-dvh bg-[#f2f0e9] text-[#24231f]">
      <div className="mx-auto min-h-dvh max-w-[1500px] border-x border-[#d8d4c8] bg-[#fbfaf6]">
        <header className="border-b border-[#d8d4c8] px-5 py-4 sm:px-8 lg:px-12">
          <div className="flex items-center justify-between gap-6">
            <a href="#content" className="flex items-center gap-3 rounded-md focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#245c4a]">
              <span className="grid size-10 place-items-center border border-[#24231f] bg-[#f2e7c9]">
                <CalendarDays className="size-5" strokeWidth={1.7} />
              </span>
              <span>
                <span className="block text-[17px] font-semibold tracking-[-0.02em]">Calendar Maew</span>
                <span className="hidden text-xs text-[#6e6a60] sm:block">Team availability, clearly.</span>
              </span>
            </a>
            <nav aria-label="เมนูหลัก" className="flex items-center gap-1 border border-[#d8d4c8] bg-white p-1">
              <button onClick={() => setView("calendar")} className={`min-h-10 cursor-pointer px-4 text-sm font-medium transition-colors ${view === "calendar" ? "bg-[#24231f] text-white" : "hover:bg-[#f2f0e9]"}`}>ปฏิทิน</button>
              <button onClick={() => setView("team")} className={`min-h-10 cursor-pointer px-4 text-sm font-medium transition-colors ${view === "team" ? "bg-[#24231f] text-white" : "hover:bg-[#f2f0e9]"}`}>ภาพรวมทีม</button>
            </nav>
            <div className="hidden items-center gap-2 sm:flex">
              <label title="เปลี่ยนรูปโปรไฟล์" className="relative grid size-11 cursor-pointer place-items-center overflow-hidden rounded-full border border-[#d8d4c8] bg-[#e7e2d6] hover:border-[#245c4a]">
                <Avatar profile={memberProfiles.find((profile) => profile.id === user?.id)} size="large" />
                <input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={isAvatarUploading} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadAvatar(file); event.target.value = ""; }} />
                <span className="absolute inset-0 grid place-items-center bg-[#24231f]/0 text-transparent transition-colors hover:bg-[#24231f]/60 hover:text-white"><ImagePlus className="size-4" /></span>
              </label>
              <button onClick={() => isSupabaseConfigured() && createClient().auth.signOut()} className="flex min-h-11 cursor-pointer items-center gap-2 border border-[#d8d4c8] bg-white px-3 text-sm hover:bg-[#f2f0e9]">
                <LogOut className="size-4" /> {memberProfiles.find((profile) => profile.id === user?.id)?.name ?? "โหมดตัวอย่าง"}
              </button>
            </div>
          </div>
        </header>

        <section id="content" className="grid lg:grid-cols-[minmax(0,1fr)_330px]">
          <div className="min-w-0 px-5 py-8 sm:px-8 lg:border-r lg:border-[#d8d4c8] lg:px-12 lg:py-10">
            <div className="mb-8 flex flex-col justify-between gap-5 md:flex-row md:items-end">
              <div>
                <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.16em] text-[#6e6a60]">
                  <Clock3 className="size-4" /> Availability workspace
                </p>
                <h1 className="max-w-2xl text-3xl font-semibold leading-tight tracking-[-0.045em] sm:text-4xl">
                  ปฏิทินของคนไม่ค่อยจะว่าง
                </h1>
                <p className="mt-3 max-w-xl text-[15px] leading-6 text-[#6e6a60]">
                  ดูวันที่ที่ทุกคนพอจะว่างพร้อมกันได้เร็วขึ้น โดยไม่ต้องไล่ถามทีละคน
                </p>
              </div>
              <button onClick={() => isMultiSelect ? setIsMultiSelect(false) : openEditor(selectedDate)} disabled={isDataLoading || Boolean(user && !memberProfiles.some((profile) => profile.id === user.id))} className="inline-flex min-h-12 cursor-pointer items-center justify-center gap-2 bg-[#245c4a] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#194638] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#245c4a] disabled:cursor-not-allowed disabled:opacity-50">
                <PencilLine className="size-4" /> ระบุเวลาว่าง
              </button>
            </div>

            {view === "calendar" ? (
              <section aria-label="ปฏิทินประจำเดือน" className="border border-[#cbc7bb] bg-white">
                <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#d8d4c8] px-4 py-4 sm:px-6">
                  <div className="grid gap-2 rounded-none border border-[#d8d4c8] bg-[#f8f6f0] px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[#777267]">วันที่คนพร้อมมากสุด</p>
                    <div className="flex flex-wrap gap-2">
                      {bestDays.map(({ key }) => <button key={key} onClick={() => setSelectedDate(new Date(key))} className="min-h-9 rounded-none border border-[#245c4a] bg-[#dcecdf] px-3 text-xs font-semibold text-[#194638] shadow-[2px_2px_0_#245c4a]">{format(new Date(key), "d MMM", { locale: th })}</button>)}
                    </div>
                  </div>
                  <div>
                    <h2 className="text-xl font-semibold tracking-[-0.025em]">{format(currentMonth, "MMMM yyyy", { locale: th })}</h2>
                    <p className="mt-0.5 text-xs text-[#777267]">คลิกวันเพื่อเพิ่มหรือแก้ไขสถานะ</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1">
                    <button onClick={() => { setIsMultiSelect((value) => !value); setSelectedDates([]); }} className={`min-h-11 cursor-pointer border px-3 text-sm font-medium ${isMultiSelect ? "border-[#245c4a] bg-[#dcecdf] text-[#194638]" : "border-[#d8d4c8] hover:bg-[#f2f0e9]"}`}>{isMultiSelect ? "ยกเลิกเลือกหลายวัน" : "เลือกหลายวัน"}</button>
                    <button onClick={() => setCurrentMonth(addMonths(currentMonth, -1))} aria-label="เดือนก่อนหน้า" className="grid size-11 cursor-pointer place-items-center border border-[#d8d4c8] hover:bg-[#f2f0e9]"><ChevronLeft className="size-4" /></button>
                    <button onClick={() => { const today = new Date(); setCurrentMonth(startOfMonth(today)); setSelectedDate(today); }} className="min-h-11 cursor-pointer border-y border-[#d8d4c8] px-4 text-sm font-medium hover:bg-[#f2f0e9]">วันนี้</button>
                    <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} aria-label="เดือนถัดไป" className="grid size-11 cursor-pointer place-items-center border border-[#d8d4c8] hover:bg-[#f2f0e9]"><ChevronRight className="size-4" /></button>
                  </div>
                </div>
                <div className="grid grid-cols-7 border-b border-[#d8d4c8] bg-[#f8f6f0]">
                  {["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."].map((day) => <div key={day} className="py-3 text-center text-xs font-semibold text-[#777267]">{day}</div>)}
                </div>
                <div className="grid grid-cols-7">
                  {days.map((day) => {
                    const key = format(day, "yyyy-MM-dd");
                    const dayRecords = getDayRecords(day);
                    const responded = dayRecords.filter(Boolean);
                    const available = dayRecords.filter((record) => record?.status === "available").length;
                    const allAvailable = responded.length === members.length && available === members.length;
                    const selected = isSameDay(day, selectedDate);
                    return (
                      <button key={key} onClick={() => { if (isMultiSelect) setSelectedDates((dates) => dates.includes(key) ? dates.filter((date) => date !== key) : [...dates, key]); else setSelectedDate(day); }} onDoubleClick={() => !isMultiSelect && openEditor(day)} aria-pressed={isMultiSelect ? selectedDates.includes(key) : undefined} aria-label={`${format(day, "d MMMM", { locale: th })}, ${available} คนว่าง`} className={`group relative min-h-[84px] cursor-pointer border-b border-r border-[#e2dfd6] p-2 text-left transition-colors sm:min-h-[118px] sm:p-3 ${!isSameMonth(day, currentMonth) ? "bg-[#f8f6f0] text-[#aaa59a]" : "hover:bg-[#f6f3e9]"} ${selected || selectedDates.includes(key) ? "inset-ring-2 inset-ring-[#245c4a]" : ""}`}>
                        <div className="flex items-start justify-between">
                          <span className={`grid size-7 place-items-center text-sm font-medium ${isSameDay(day, new Date()) ? "bg-[#24231f] text-white" : ""}`}>{format(day, "d")}</span>
                          {allAvailable && <span title="ทุกคนว่าง" className="grid size-6 place-items-center rounded-full bg-[#dcecdf] text-[#245c4a]"><Check className="size-3.5" strokeWidth={2.5} /></span>}
                        </div>
                        <div className="mt-3 hidden items-center -space-x-1 sm:flex">
                          {responded.slice(0, 5).map((record) => record && <span title={`${record.member}: ${record.status === "available" ? "ว่าง" : "ไม่ว่าง"}`} key={record.member} className={`grid size-6 place-items-center rounded-full border-2 border-white text-[8px] font-bold ${record.status === "available" ? "bg-[#dcecdf] text-[#245c4a]" : "bg-[#eee1dc] text-[#914b3a]"}`}>{initials[record.member]}</span>)}
                        </div>
                        <p className="mt-2 text-[10px] text-[#777267] sm:text-xs">{responded.length ? `${available}/${members.length} ว่าง` : "ยังไม่มีข้อมูล"}</p>
                      </button>
                    );
                  })}
                </div>
              </section>
            ) : (
              <TeamGrid currentMonth={currentMonth} members={members} profiles={memberProfiles} records={records} onSelect={openEditor} />
            )}
          </div>

          <aside className="border-t border-[#d8d4c8] bg-[#f8f6f0] px-5 py-8 sm:px-8 lg:border-t-0 lg:px-7 lg:py-10">
            <div className="lg:sticky lg:top-6">
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#777267]">วันที่เลือก</p>
              <h2 className="mt-2 text-2xl font-semibold tracking-[-0.035em]">{format(selectedDate, "d MMMM", { locale: th })}</h2>
              <p className="text-sm text-[#777267]">{format(selectedDate, "EEEE yyyy", { locale: th })}</p>

              <div className="my-6 grid grid-cols-2 border border-[#d8d4c8] bg-white">
                <div className="border-r border-[#d8d4c8] p-4"><strong className="block text-2xl">{availableCount}</strong><span className="text-xs text-[#777267]">ว่าง</span></div>
                <div className="p-4"><strong className="block text-2xl">{responseCount}</strong><span className="text-xs text-[#777267]">ตอบแล้ว</span></div>
              </div>

              <label className="relative mb-3 block">
                <span className="sr-only">ค้นหาสมาชิก</span>
                <Search className="pointer-events-none absolute left-3 top-3 size-4 text-[#777267]" />
                <input value={memberQuery} onChange={(event) => setMemberQuery(event.target.value)} placeholder="ค้นหาสมาชิก" className="min-h-10 w-full border border-[#d8d4c8] bg-white pl-9 pr-3 text-sm outline-none focus:border-[#245c4a]" />
              </label>
              <div className="max-h-[520px] space-y-2 overflow-y-auto">
                {visibleMembers.map((member) => {
                  const record = selectedRecords.find((item) => item?.member === member);
                  const profile = memberProfiles.find((item) => item.name === member);
                  return (
                    <div key={member} className="flex min-h-14 w-full items-center gap-3 border-b border-[#dedbd2] px-1 text-left">
                      <Avatar profile={profile} />
                      <span className="min-w-0 flex-1"><span className="block text-sm font-medium">{member}</span><span className="block truncate text-xs text-[#777267]">{record?.reason || (record ? "ไม่มีเหตุผลเพิ่มเติม" : "ยังไม่ตอบ")}</span></span>
                      <span className={`size-2.5 rounded-full ${record?.status === "available" ? "bg-[#4f8b6f]" : record?.status === "busy" ? "bg-[#a65d4d]" : "border border-[#aaa59a]"}`} />
                    </div>
                  );
                })}
              </div>
              <button onClick={() => openEditor(selectedDate)} disabled={isDataLoading} className="mt-6 flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 border border-[#24231f] bg-white text-sm font-semibold hover:bg-[#24231f] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"><PencilLine className="size-4" /> แก้ไขสถานะของฉัน</button>
            </div>
          </aside>
        </section>
      </div>

      {isMultiSelect && selectedDates.length > 0 && (
        <div className="fixed bottom-5 left-1/2 z-40 flex w-[calc(100%-2rem)] max-w-xl -translate-x-1/2 items-center gap-3 border border-[#24231f] bg-[#fbfaf6] p-3 shadow-[6px_6px_0_#24231f]">
          <strong className="flex-1 text-sm">เลือกแล้ว {selectedDates.length} วัน</strong>
          <button onClick={() => setSelectedDates([])} aria-label="ล้างวันที่เลือก" className="grid size-11 cursor-pointer place-items-center border border-[#d8d4c8] hover:bg-[#eeeae0]"><Trash2 className="size-4" /></button>
          <button onClick={() => { const first = selectedDates[0].split("-").map(Number); openEditor(new Date(first[0], first[1] - 1, first[2])); }} className="min-h-11 cursor-pointer bg-[#245c4a] px-5 text-sm font-semibold text-white hover:bg-[#194638]">กำหนดสถานะ</button>
        </div>
      )}

      {notice && (
        <div role="status" aria-live="polite" className={`fixed bottom-5 right-5 z-[60] max-w-sm border px-4 py-3 text-sm shadow-[5px_5px_0_#24231f] ${notice.tone === "success" ? "border-[#245c4a] bg-[#dcecdf] text-[#194638]" : "border-[#914b3a] bg-[#eee1dc] text-[#71372a]"}`}>
          {notice.message}
        </div>
      )}

      {isModalOpen && (
        <div role="presentation" onMouseDown={(event) => event.currentTarget === event.target && setIsModalOpen(false)} className="fixed inset-0 z-50 flex items-end justify-center bg-[#24231f]/45 p-0 backdrop-blur-[2px] sm:items-center sm:p-5">
          <section role="dialog" aria-modal="true" aria-labelledby="dialog-title" className="motion-safe:animate-[dialog-in_180ms_ease-out] w-full max-w-lg border border-[#24231f] bg-[#fbfaf6] shadow-[10px_10px_0_#24231f] sm:max-h-[90dvh]">
            <div className="flex items-start justify-between border-b border-[#d8d4c8] p-5 sm:p-6">
              <div><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#777267]">ระบุเวลาว่าง</p><h2 id="dialog-title" className="mt-1 text-2xl font-semibold tracking-[-0.035em]">{selectedDates.length > 1 ? `${selectedDates.length} วันที่เลือก` : format(selectedDate, "d MMMM yyyy", { locale: th })}</h2></div>
              <button onClick={() => setIsModalOpen(false)} aria-label="ปิดหน้าต่าง" className="grid size-11 cursor-pointer place-items-center border border-[#d8d4c8] hover:bg-[#eeeae0]"><X className="size-5" /></button>
            </div>
            <div className="space-y-6 p-5 sm:p-6">
              <div className="grid gap-2 text-sm font-semibold">สมาชิก
                <div className="flex min-h-12 items-center gap-3 border border-[#d8d4c8] bg-[#f2f0e9] px-3 font-normal"><CircleUserRound className="size-5 text-[#777267]" />{memberProfiles.find((profile) => profile.id === user?.id)?.name ?? selectedMember}</div>
                <p className="text-xs font-normal text-[#777267]">คุณแก้ไขได้เฉพาะสถานะของตัวเอง</p>
              </div>
              <fieldset><legend className="mb-2 text-sm font-semibold">สถานะ</legend><div className="grid grid-cols-2 gap-3">
                <button onClick={() => setSelectedStatus("available")} className={`min-h-14 cursor-pointer border px-4 text-sm font-semibold ${selectedStatus === "available" ? "border-[#245c4a] bg-[#dcecdf] text-[#194638]" : "border-[#d8d4c8] bg-white"}`}>ว่าง</button>
                <button onClick={() => setSelectedStatus("busy")} className={`min-h-14 cursor-pointer border px-4 text-sm font-semibold ${selectedStatus === "busy" ? "border-[#914b3a] bg-[#eee1dc] text-[#71372a]" : "border-[#d8d4c8] bg-white"}`}>ไม่ว่าง</button>
              </div></fieldset>
              <fieldset><legend className="mb-2 text-sm font-semibold">เหตุผล <span className="font-normal text-[#777267]">(ไม่บังคับ)</span></legend><div className="flex flex-wrap gap-2">{reasons.map((reason) => <button key={reason} onClick={() => setSelectedReason(selectedReason === reason ? "" : reason)} className={`min-h-10 cursor-pointer rounded-full border px-4 text-sm ${selectedReason === reason ? "border-[#24231f] bg-[#24231f] text-white" : "border-[#cbc7bb] bg-white hover:bg-[#f2f0e9]"}`}>{reason}</button>)}</div></fieldset>
            </div>
            <div className="grid grid-cols-2 border-t border-[#d8d4c8]">
              <button onClick={() => setIsModalOpen(false)} className="min-h-14 cursor-pointer border-r border-[#d8d4c8] font-semibold hover:bg-[#eeeae0]">ยกเลิก</button>
              <button disabled={isSaving} onClick={submitAvailability} className="flex min-h-14 cursor-pointer items-center justify-center gap-2 bg-[#245c4a] font-semibold text-white hover:bg-[#194638] disabled:cursor-not-allowed disabled:opacity-60">{isSaving && <LoaderCircle className="size-4 animate-spin" />} {isSaving ? "กำลังบันทึก" : "บันทึกสถานะ"}</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}

function translateAuthError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid login credentials")) return "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง";
  if (normalized.includes("already registered") || normalized.includes("already been registered")) return "ชื่อผู้ใช้นี้ถูกใช้แล้ว";
  if (normalized.includes("signups are disabled")) return "ระบบยังไม่เปิดรับสมาชิกใหม่ กรุณาติดต่อผู้ดูแล";
  if (normalized.includes("rate limit") || normalized.includes("too many")) return "ลองหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่";
  if (normalized.includes("password")) return "รหัสผ่านไม่เป็นไปตามเงื่อนไข กรุณาใช้อย่างน้อย 8 ตัวอักษร";
  if (normalized.includes("fetch") || normalized.includes("network")) return "ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่";
  return "ดำเนินการไม่สำเร็จ กรุณาลองใหม่หรือติดต่อผู้ดูแล";
}

function AuthScreen() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState("");
  const [showPassword, setShowPassword] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const username = String(form.get("username")).trim().toLowerCase();
    const password = String(form.get("password"));
    const displayName = String(form.get("displayName") ?? username).trim();
    const email = `${username.replace(/[^a-z0-9._-]/g, "-")}@${usernameDomain}`;
    setIsSubmitting(true);
    setMessage("");
    const supabase = createClient();
    const result = mode === "signin"
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { data: { display_name: displayName, username } } });
    setMessage(result.error ? translateAuthError(result.error.message) : (mode === "signup" ? "สร้างบัญชีและเข้าร่วมทีมเรียบร้อยแล้ว" : "เข้าสู่ระบบสำเร็จ"));
    setIsSubmitting(false);
  };

  return (
    <main className="grid min-h-dvh place-items-center bg-[#f2f0e9] p-5">
      <section className="w-full max-w-md border border-[#24231f] bg-[#fbfaf6] shadow-[10px_10px_0_#24231f]">
        <div className="border-b border-[#d8d4c8] p-6"><CalendarDays className="mb-6 size-8" /><h1 className="text-3xl font-semibold tracking-[-0.04em]">{mode === "signin" ? "ยินดีต้อนรับกลับ" : "สร้างบัญชีของคุณ"}</h1><p className="mt-2 text-sm text-[#6e6a60]">เข้าสู่ Calendar Maew เพื่อดูเวลาว่างของทีม</p></div>
        <form onSubmit={submit} className="space-y-4 p-6">
          {mode === "signup" && <label className="grid gap-2 text-sm font-semibold">ชื่อที่แสดง<input required name="displayName" className="min-h-12 border border-[#aaa59a] bg-white px-3 font-normal outline-none focus:border-[#245c4a]" /></label>}
          <label className="grid gap-2 text-sm font-semibold">ชื่อผู้ใช้<input required name="username" minLength={3} pattern="[A-Za-z0-9._-]+" autoComplete="username" placeholder="เช่น somchai" className="min-h-12 border border-[#aaa59a] bg-white px-3 font-normal lowercase outline-none focus:border-[#245c4a]" /><span className="text-xs font-normal text-[#777267]">ใช้ตัวอักษรอังกฤษ ตัวเลข จุด ขีดกลาง หรือขีดล่าง</span></label>
          <label className="grid gap-2 text-sm font-semibold">รหัสผ่าน<div className="relative"><input required minLength={8} name="password" type={showPassword ? "text" : "password"} autoComplete={mode === "signin" ? "current-password" : "new-password"} className="min-h-12 w-full border border-[#aaa59a] bg-white px-3 pr-20 font-normal outline-none focus:border-[#245c4a]" /><button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-1 top-1 min-h-10 cursor-pointer px-3 text-xs font-medium underline underline-offset-2">{showPassword ? "ซ่อน" : "แสดง"}</button></div>{mode === "signup" && <span className="text-xs font-normal text-[#777267]">อย่างน้อย 8 ตัวอักษร</span>}</label>
          {message && <p role="status" className="border border-[#d8d4c8] bg-white p-3 text-sm">{message}</p>}
          <button disabled={isSubmitting} className="flex min-h-12 w-full cursor-pointer items-center justify-center gap-2 bg-[#245c4a] font-semibold text-white disabled:opacity-60">{isSubmitting && <LoaderCircle className="size-4 animate-spin" />}{mode === "signin" ? "เข้าสู่ระบบ" : "สมัครสมาชิก"}</button>
          <button type="button" onClick={() => setMode(mode === "signin" ? "signup" : "signin")} className="min-h-11 w-full cursor-pointer text-sm font-medium underline underline-offset-4">{mode === "signin" ? "ยังไม่มีบัญชี? สมัครสมาชิก" : "มีบัญชีแล้ว? เข้าสู่ระบบ"}</button>
        </form>
      </section>
    </main>
  );
}

function Avatar({ profile, size = "small" }: { profile?: MemberProfile; size?: "small" | "large" }) {
  const fallback = profile?.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "CM";
  const classes = size === "large" ? "size-11 text-sm" : "size-9 text-xs";
  if (profile?.avatarUrl) return <img src={profile.avatarUrl} alt={`รูปโปรไฟล์ของ ${profile.name}`} className={`${classes} rounded-full object-cover`} />;
  return <span aria-hidden="true" className={`grid ${classes} place-items-center rounded-full bg-[#dcecdf] font-bold text-[#194638]`}>{fallback}</span>;
}

function TeamGrid({ currentMonth, members, profiles, records, onSelect }: { currentMonth: Date; members: string[]; profiles: MemberProfile[]; records: AvailabilityRecord[]; onSelect: (day: Date) => void }) {
  const days = eachDayOfInterval({ start: startOfMonth(currentMonth), end: endOfMonth(currentMonth) }).slice(0, 14);
  return (
    <section className="border border-[#cbc7bb] bg-white">
      <div className="border-b border-[#d8d4c8] p-5 sm:p-6"><p className="text-xs font-semibold uppercase tracking-[0.16em] text-[#777267]">Team overview</p><h2 className="mt-1 text-2xl font-semibold tracking-[-0.035em]">ภาพรวม 14 วัน</h2><p className="mt-1 text-sm text-[#777267]">สีเขียวคือว่าง สีอิฐคือไม่ว่าง และจุดโปร่งคือยังไม่ตอบ</p></div>
      <div className="overflow-x-auto">
        <div className="min-w-[820px]">
          <div className="grid grid-cols-[150px_repeat(14,1fr)] border-b border-[#d8d4c8] bg-[#f8f6f0]"><div className="p-3 text-xs font-semibold text-[#777267]">สมาชิก</div>{days.map((day) => <button onClick={() => onSelect(day)} key={day.toISOString()} className="cursor-pointer border-l border-[#e2dfd6] p-2 text-center hover:bg-[#eeeae0]"><span className="block text-[10px] text-[#777267]">{format(day, "EEE")}</span><strong className="text-sm">{format(day, "d")}</strong></button>)}</div>
          {members.map((member) => <div key={member} className="grid grid-cols-[150px_repeat(14,1fr)] border-b border-[#e2dfd6]"><div className="flex items-center gap-2 p-3 text-sm font-medium"><Avatar profile={profiles.find((item) => item.name === member)} />{member}</div>{days.map((day) => { const record = records.find((item) => item.member === member && item.date === format(day, "yyyy-MM-dd")); return <button title={record?.reason || "ยังไม่ตอบ"} onClick={() => onSelect(day)} key={day.toISOString()} className="grid min-h-14 cursor-pointer place-items-center border-l border-[#e2dfd6] hover:bg-[#f2f0e9]"><span className={`size-5 rounded-full ${record?.status === "available" ? "bg-[#4f8b6f]" : record?.status === "busy" ? "bg-[#a65d4d]" : "border border-[#aaa59a]"}`} /></button>; })}</div>)}
        </div>
      </div>
    </section>
  );
}

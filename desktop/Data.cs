using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Security.Cryptography;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;

namespace PhrasePocket {
    public sealed class Entry {
        public string id { get; set; }
        public string kind { get; set; }
        public string text { get; set; }
        public string meaning { get; set; }
        public string source { get; set; }
        public string createdAt { get; set; }
        public string review { get; set; }
        public string reviewedAt { get; set; }
    }

    public sealed class Settings {
        public string display { get; set; }
        public bool showMeaning { get; set; }
        public int intervalMinutes { get; set; }
        public string model { get; set; }
        public int? x { get; set; }
        public int? y { get; set; }
        public Settings() {
            display = "all"; showMeaning = true; intervalMinutes = 5; model = "";
        }
    }

    internal sealed class Request {
        public string op { get; set; }
        public string id { get; set; }
        public string kind { get; set; }
        public string text { get; set; }
        public string meaning { get; set; }
        public string context { get; set; }
        public int offset { get; set; }
        public List<Entry> entries { get; set; }
    }

    internal static class Data {
        internal static readonly UTF8Encoding Utf8 = new UTF8Encoding(false, true);
        internal static readonly string Home = Path.GetFullPath(
            Environment.GetEnvironmentVariable("PHRASE_POCKET_HOME") ??
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "PhrasePocket"));
        internal static readonly string EntriesPath = Path.Combine(Home, "entries.json");
        internal static readonly string SettingsPath = Path.Combine(Home, "settings.json");
        internal static readonly string DictionaryPath = Path.Combine(Home, "ecdict.db");
        internal static readonly string LockSuffix = Fingerprint(Home.ToUpperInvariant()).Substring(0, 24);

        internal static JavaScriptSerializer Json() {
            return new JavaScriptSerializer { MaxJsonLength = 32000000, RecursionLimit = 32 };
        }
        private static string Fingerprint(string path) {
            using (var hash = SHA256.Create()) {
                return BitConverter.ToString(hash.ComputeHash(Utf8.GetBytes(path))).Replace("-", "");
            }
        }
        internal static string Normalize(string text) {
            return Regex.Replace((text ?? "").Normalize(NormalizationForm.FormKC)
                .Replace('’', '\'').Replace('‘', '\'').Trim().TrimEnd('.', '!', '?', '…').Trim()
                .ToLowerInvariant(), @"\s+", " ");
        }
        internal static string Clean(string text, int max) {
            text = (text ?? "").Trim();
            if (text.Length > max) text = text.Substring(0, char.IsHighSurrogate(text[max - 1]) ? max - 1 : max);
            return text.Replace("\0", "");
        }
        internal static string Now() {
            return DateTime.UtcNow.ToString("o", CultureInfo.InvariantCulture);
        }
        private static void Write<T>(string path, T value) {
            Directory.CreateDirectory(Home);
            string temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
            try {
                File.WriteAllText(temp, Json().Serialize(value), Utf8);
                if (File.Exists(path)) File.Replace(temp, path, null);
                else File.Move(temp, path);
            } finally {
                if (File.Exists(temp)) File.Delete(temp);
            }
        }
        internal static T Entries<T>(Func<List<Entry>,T> work, bool save) {
            using (var gate = new Mutex(false, @"Local\PhrasePocket-Data-" + LockSuffix)) {
                try {
                    if (!gate.WaitOne(6000)) throw new IOException("Collection is busy.");
                } catch (AbandonedMutexException) { }
                try {
                    var entries = File.Exists(EntriesPath)
                        ? Json().Deserialize<List<Entry>>(File.ReadAllText(EntriesPath, Utf8))
                        : new List<Entry>();
                    if (entries == null) throw new IOException("Invalid collection.");
                    T result = work(entries);
                    if (save) Write(EntriesPath, entries);
                    return result;
                } finally { gate.ReleaseMutex(); }
            }
        }
        internal static Settings ReadSettings() {
            var value = File.Exists(SettingsPath) ? Json().Deserialize<Settings>(File.ReadAllText(SettingsPath, Utf8)) : null;
            value = value ?? new Settings();
            if (value.display != "word" && value.display != "note") value.display = "all";
            if (value.intervalMinutes < 1 || value.intervalMinutes > 180) value.intervalMinutes = 5;
            value.model = Clean(value.model, 96);
            return value;
        }
        internal static void SaveSettings(Settings settings) { Write(SettingsPath, settings); }
    }

    internal static class Collection {
        internal static readonly object Bad = new { ok=false, code="bad_request" };
        internal static readonly object Missing = new { ok=false, code="not_found" };
        internal static bool SameText(string kind, string a, string b) {
            return kind == "word" ? Data.Normalize(a) == Data.Normalize(b) : a == b;
        }
        internal static object Handle(Request request) {
            if (request == null) return Bad;
            switch (request.op) {
                case "ping": return new { ok=true, version=1 };
                case "save": return Save(request);
                case "import": return Import(request);
                case "list": return Data.Entries<object>(entries => {
                    int offset = Math.Min(Math.Max(request.offset, 0), entries.Count);
                    return new { ok=true, entries=entries.AsEnumerable().Reverse().Skip(offset).Take(100).ToArray(), total=entries.Count };
                }, false);
                case "update": return Update(request);
                case "delete": return Data.Entries<object>(entries => {
                    int removed = entries.RemoveAll(x => x.id == request.id);
                    return removed == 0 ? Missing : new { ok=true };
                }, true);
                case "retry": return Retry(request);
                case "enrich": return Enrich(request);
                default: return Bad;
            }
        }
        private static object Save(Request request) {
            string kind = request.kind, text = Data.Clean(request.text, 240);
            if ((kind != "word" && kind != "note") || text.Length == 0 ||
                (kind == "word" && Data.Normalize(text).Length == 0)) return Bad;
            return Data.Entries<object>(entries => {
                var existing = entries.Find(x => x.kind == kind && SameText(kind, x.text, text));
                if (existing != null) return new { ok=true, entry=existing, duplicate=true, enrich=CanEnrich(existing) };
                var entry = new Entry { id=Guid.NewGuid().ToString("N"), kind=kind, text=text, meaning="", source="", createdAt=Data.Now() };
                if (kind == "word") Definitions.Fill(entry, request.context);
                entries.Add(entry);
                return new { ok=true, entry=entry, duplicate=false, enrich=CanEnrich(entry) };
            }, true);
        }
        private static object Import(Request request) {
            if (request.entries == null || request.entries.Count > 5) return Bad;
            if (request.entries.Any(x => x == null || (x.kind != "word" && x.kind != "note") ||
                string.IsNullOrEmpty(Data.Clean(x.text,240)) ||
                (x.kind == "word" && Data.Normalize(Data.Clean(x.text,240)).Length == 0))) return Bad;
            return Data.Entries<object>(entries => {
                foreach (var item in request.entries) {
                    string text = Data.Clean(item.text,240);
                    string meaning = item.kind == "word" ? Data.Clean(item.meaning,320) : "";
                    var existing = entries.Find(x => x.kind == item.kind && SameText(item.kind,x.text,text));
                    string source = item.source == "builtin" || item.source == "ecdict" || item.source == "model" ? item.source : "manual";
                    if (existing != null) {
                        if (meaning.Length > 0 && (string.IsNullOrEmpty(existing.meaning) || (source == "manual" && existing.source != "manual"))) {
                            existing.meaning = meaning;
                            existing.source = source;
                        }
                        continue;
                    }
                    DateTime stamp;
                    var imported = new Entry {id=Guid.NewGuid().ToString("N"), kind=item.kind, text=text,
                        meaning=meaning, source=meaning.Length > 0 ? source : "",
                        createdAt=DateTime.TryParse(item.createdAt, CultureInfo.InvariantCulture, DateTimeStyles.RoundtripKind, out stamp)
                            ? stamp.ToUniversalTime().ToString("o",CultureInfo.InvariantCulture) : Data.Now()};
                    if (imported.kind == "word" && meaning.Length == 0) Definitions.Fill(imported, "");
                    entries.Add(imported);
                }
                return new {ok=true};
            }, true);
        }
        private static object Update(Request request) {
            string text = Data.Clean(request.text, 240);
            string meaning = Data.Clean(request.meaning, 320);
            if (text.Length == 0) return Bad;
            return Data.Entries<object>(entries => {
                var entry = entries.Find(x => x.id == request.id);
                if (entry == null) return Missing;
                if (entry.kind == "word" && Data.Normalize(text).Length == 0) return Bad;
                if (entries.Any(x => x.id != entry.id && x.kind == entry.kind && SameText(x.kind, x.text, text)))
                    return new { ok=false, code="duplicate" };
                bool changed = !SameText(entry.kind, entry.text, text);
                entry.text = text;
                if (entry.kind == "word") {
                    if (changed && meaning == entry.meaning) {
                        entry.meaning = entry.source = "";
                        Definitions.Fill(entry, "");
                    } else if (entry.meaning != meaning) {
                        entry.meaning = meaning;
                        entry.source = meaning.Length == 0 ? "" : "manual";
                    }
                    if (changed) { entry.review = null; entry.reviewedAt = null; }
                }
                return new { ok=true, entry=entry, enrich=changed && CanEnrich(entry) };
            }, true);
        }
        private static object Retry(Request request) {
            return Data.Entries<object>(entries => {
                var entry = entries.Find(x => x.id == request.id && x.kind == "word");
                if (entry == null) return Missing;
                if (string.IsNullOrEmpty(entry.meaning)) Definitions.Fill(entry, "");
                return new { ok=true, entry=entry, enrich=CanEnrich(entry) };
            }, true);
        }
        private static bool CanEnrich(Entry entry) {
            if (entry.kind != "word" || !string.IsNullOrEmpty(entry.meaning)) return false;
            try { return Definitions.ValidModel(Data.ReadSettings().model); }
            catch (IOException) { return false; }
            catch (UnauthorizedAccessException) { return false; }
            catch (ArgumentException) { return false; }
            catch (InvalidOperationException) { return false; }
        }
        private static object Enrich(Request request) {
            var entry = Data.Entries(entries => entries.Find(x => x.id == request.id && x.kind == "word"), false);
            if (entry == null) return Missing;
            if (!CanEnrich(entry)) return new { ok=true, entry=entry };
            string meaning = Definitions.FromModel(Data.ReadSettings().model, entry.text, request.context);
            if (string.IsNullOrEmpty(meaning)) return new { ok=true, entry=entry };
            return Data.Entries<object>(entries => {
                var latest = entries.Find(x => x.id == entry.id);
                if (latest == null) return Missing;
                if (latest.text == entry.text && string.IsNullOrEmpty(latest.meaning)) {
                    latest.meaning = meaning; latest.source = "model";
                }
                return new { ok=true, entry=latest };
            }, true);
        }
    }
}

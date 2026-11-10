using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Drawing;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Windows.Forms;

namespace PhrasePocket {
    internal static class Program {
        private const string Origin = "chrome-extension://jhioomhdcaphdijkhegcbakheknicgdc/";
        [STAThread]
        internal static int Main(string[] args) {
            if (args.Length > 0 && args[0].StartsWith("chrome-extension://", StringComparison.Ordinal)) {
                return args[0] == Origin || args[0] + "/" == Origin ? NativeHost.Run() : 2;
            }
            if (args.Length == 2 && args[0] == "--import-dictionary") {
                try { DictionaryDb.Import(args[1]); return 0; } catch { return 1; }
            }
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            if (args.Length == 1 && args[0] == "--ui-smoke") {
                using (var preview = new CardForm(null, false)) { preview.CreateControl(); }
                return 0;
            }
            try {
                bool first;
                using (var signal = new EventWaitHandle(false, EventResetMode.AutoReset, @"Local\PhrasePocket-Open-" + Data.LockSuffix))
                using (var instance = new Mutex(true, @"Local\PhrasePocket-UI-" + Data.LockSuffix, out first)) {
                    if (!first) { signal.Set(); return 0; }
                    try { Application.Run(new CardForm(signal, true)); }
                    finally { instance.ReleaseMutex(); }
                }
                return 0;
            } catch (Exception) {
                MessageBox.Show("无法打开桌面卡片。请检查本机收藏目录是否可读写。", "随手收", MessageBoxButtons.OK, MessageBoxIcon.Warning);
                return 1;
            }
        }
    }

    internal static class NativeHost {
        internal static int Run() {
            try {
                using (var input = new BinaryReader(Console.OpenStandardInput()))
                using (var output = new BinaryWriter(Console.OpenStandardOutput())) {
                    int length = input.ReadInt32();
                    if (length <= 0 || length > 16384) return 2;
                    byte[] bytes = input.ReadBytes(length);
                    if (bytes.Length != length) return 2;
                    var json = Data.Json();
                    object result;
                    try { result = Collection.Handle(json.Deserialize<Request>(Data.Utf8.GetString(bytes))); }
                    catch (ArgumentException) { result = Collection.Bad; }
                    catch (Exception ex) {
                        if (Environment.GetEnvironmentVariable("PHRASE_POCKET_DEBUG") == "1") Console.Error.WriteLine(ex);
                        result = new { ok=false, code="storage" };
                    }
                    byte[] answer = Data.Utf8.GetBytes(json.Serialize(result));
                    if (answer.Length >= 1048576) return 2;
                    output.Write(answer.Length);
                    output.Write(answer);
                    output.Flush();
                    return 0;
                }
            } catch (IOException) { return 2; }
        }
    }

    internal sealed class CardForm : Form {
        private static readonly Color Paper = Color.FromArgb(255, 254, 247);
        private static readonly Color Ink = Color.FromArgb(31, 54, 42);
        private static readonly Color Dim = Color.FromArgb(76, 96, 81);
        private static readonly Color Leaf = Color.FromArgb(44, 91, 65);
        private static readonly Color Soft = Color.FromArgb(231, 239, 225);
        private static readonly Color Peach = Color.FromArgb(173, 108, 100);
        private readonly Label kindLabel, termLabel, meaningLabel, footLabel, stripe;
        private readonly Button revealButton, againButton, knownButton, nextButton;
        private readonly NotifyIcon tray;
        private readonly ContextMenuStrip menu;
        private readonly System.Windows.Forms.Timer timer;
        private readonly ToolTip tip = new ToolTip();
        private readonly EventWaitHandle openSignal;
        private readonly Random random = new Random();
        private readonly Settings settings;
        private List<Entry> entries = new List<Entry>();
        private Entry current;
        private DateTime deadline, lastWrite = DateTime.MinValue;
        private bool revealed, quitting, moving, readError;
        private Point dragPoint, startPoint;

        protected override bool ShowWithoutActivation { get { return true; } }
        protected override CreateParams CreateParams {
            get {
                var cp = base.CreateParams;
                cp.ExStyle |= 0x00000080; // A utility window stays out of Alt+Tab.
                return cp;
            }
        }
        internal CardForm(EventWaitHandle signal, bool showTray) {
            openSignal = signal;
            settings = Data.ReadSettings();
            Font = new Font("Microsoft YaHei UI", 9);
            AutoScaleMode = AutoScaleMode.Dpi;
            AutoScaleDimensions = new SizeF(96,96);
            Text = "随手收";
            BackColor = Paper; ForeColor = Ink;
            FormBorderStyle = FormBorderStyle.None;
            ShowInTaskbar = false; TopMost = true;
            StartPosition = FormStartPosition.Manual;
            ClientSize = new Size(354, 237);
            Padding = new Padding(1);
            var title = LabelAt("✦  随手收", 14, 9, 210, 24, 10, true);
            title.ForeColor = Leaf;
            title.MouseDown += DragStart; title.MouseMove += DragMove; title.MouseUp += DragEnd;
            stripe = LabelAt("", 0, 0, 354, 3, 9, false);
            stripe.BackColor = Leaf;
            kindLabel = LabelAt("", 14, 37, 310, 19, 9, false);
            kindLabel.ForeColor = Dim;
            termLabel = LabelAt("", 14, 57, 326, 55, 16, true);
            meaningLabel = LabelAt("", 14, 112, 326, 52, 10, false);
            footLabel = LabelAt("", 14, 211, 326, 18, 8, false);
            footLabel.ForeColor = Dim;
            revealButton = ButtonAt("看释义", 14, 176, 77, delegate {
                revealed = !revealed; ResetClock(); RenderCard();
            });
            againButton = ButtonAt("再见一次", 96, 176, 77, delegate { Mark("again"); });
            knownButton = ButtonAt("记住了", 178, 176, 77, delegate { Mark("known"); });
            nextButton = ButtonAt("下一条", 260, 176, 80, delegate { Choose(true); });
            var more = ButtonAt("⋯", 270, 6, 34, delegate { ShowMenuAt(new Point(270, 38)); });
            more.AccessibleName = "桌面卡片设置";
            var hide = ButtonAt("×", 307, 6, 33, HideCard);
            hide.AccessibleName = "收起到系统托盘";

            menu = new ContextMenuStrip();
            menu.Opening += delegate { BuildMenu(); };
            tray = new NotifyIcon { Icon=SystemIcons.Information, Text="随手收 · 桌面卡片", ContextMenuStrip=menu, Visible=showTray };
            tray.DoubleClick += delegate { ShowCard(); };
            MouseUp += delegate(object sender, MouseEventArgs args) {
                if (args.Button == MouseButtons.Right) ShowMenuAt(args.Location);
            };
            FormClosing += delegate(object sender, FormClosingEventArgs e) {
                if (!quitting && e.CloseReason == CloseReason.UserClosing) { e.Cancel = true; HideCard(); }
            };
            var area = Screen.PrimaryScreen.WorkingArea;
            Location = new Point(area.Right - Width - 19, area.Top + 24);
            if (settings.x.HasValue && settings.y.HasValue) {
                var candidate = new Rectangle(settings.x.Value, settings.y.Value, Width, Height);
                if (Screen.AllScreens.Any(s => s.WorkingArea.Contains(candidate))) Location = candidate.Location;
            }
            Reload(false);
            if (current == null) Choose(false);
            timer = new System.Windows.Forms.Timer { Interval=1300, Enabled=showTray };
            timer.Tick += Tick;
        }
        private Label LabelAt(string text, int x, int y, int w, int h, float size, bool bold) {
            var control = new Label {
                Text=text, Bounds=new Rectangle(x,y,w,h), AutoEllipsis=true, UseMnemonic=false,
                Font=new Font("Microsoft YaHei UI", size, bold ? FontStyle.Bold : FontStyle.Regular)
            };
            Controls.Add(control); return control;
        }
        private Button ButtonAt(string text, int x, int y, int w, Action handler) {
            var button = new Button {
                Text=text, Bounds=new Rectangle(x,y,w,29), BackColor=Soft, ForeColor=Ink,
                FlatStyle=FlatStyle.Flat, UseVisualStyleBackColor=false, Cursor=Cursors.Hand
            };
            button.FlatAppearance.BorderSize=0;
            button.Click += delegate { handler(); };
            Controls.Add(button); return button;
        }
        private void DragStart(object sender, MouseEventArgs e) {
            if (e.Button != MouseButtons.Left) return;
            dragPoint = MousePosition; startPoint = Location; moving = true;
        }
        private void DragMove(object sender, MouseEventArgs e) {
            if (!moving) return;
            var pointer = MousePosition;
            Location = new Point(startPoint.X + pointer.X - dragPoint.X, startPoint.Y + pointer.Y - dragPoint.Y);
        }
        private void DragEnd(object sender, MouseEventArgs e) {
            if (!moving) return;
            moving = false;
            var area = Screen.FromControl(this).WorkingArea;
            Location = new Point(Math.Max(area.Left, Math.Min(Left, area.Right - Width)),
                Math.Max(area.Top, Math.Min(Top, area.Bottom - Height)));
            settings.x = Left; settings.y = Top;
            SaveSettings();
        }
        private void SaveSettings() {
            try { Data.SaveSettings(settings); }
            catch (Exception) { footLabel.Text = "设置未能保存，请检查本机存储。"; }
        }
        private void Tick(object sender, EventArgs e) {
            if (openSignal != null && openSignal.WaitOne(0)) ShowCard();
            Reload(true);
            if (Visible && !moving && !menu.Visible && DateTime.UtcNow >= deadline &&
                !RectangleToScreen(ClientRectangle).Contains(MousePosition)) Choose(true);
        }
        private void Reload(bool jumpToNew) {
            try {
                var stamp = File.GetLastWriteTimeUtc(Data.EntriesPath);
                if (stamp == lastWrite) return;
                var previous = new HashSet<string>(entries.Select(x => x.id));
                var latest = Data.Entries(list => list, false);
                lastWrite = stamp;
                readError = false;
                entries = latest;
                var replacement = current == null ? null : entries.Find(x => x.id == current.id);
                var newEntry = jumpToNew ? entries.FindLast(x => !previous.Contains(x.id) && Eligible(x)) : null;
                if (newEntry != null) Select(newEntry);
                else if (replacement == null || !Eligible(replacement)) Choose(false);
                else if (replacement.meaning != current.meaning || replacement.text != current.text || replacement.source != current.source) {
                    current = replacement;
                    RenderCard();
                } else current = replacement;
            } catch (Exception) {
                readError = true;
                RenderCard();
            }
        }
        private bool Matches(Entry entry) {
            return settings.display == "all" || entry.kind == settings.display;
        }
        private bool Eligible(Entry entry) {
            if (!Matches(entry)) return false;
            DateTime when;
            return entry.review != "known" || !DateTime.TryParse(entry.reviewedAt, out when) ||
                when.ToLocalTime().Date != DateTime.Now.Date;
        }
        private void Choose(bool alternate) {
            var valid = entries.Where(Eligible).ToList();
            var others = valid.Where(x => current == null || x.id != current.id).ToList();
            var opposite = alternate && current != null && settings.display == "all"
                ? others.Where(x => x.kind != current.kind).ToList() : new List<Entry>();
            var pool = opposite.Count != 0 ? opposite : others.Count != 0 ? others : valid;
            var weighted = pool.SelectMany(x => x.review == "again" ? new[]{x,x} : new[]{x}).ToArray();
            Select(weighted.Length == 0 ? null : weighted[random.Next(weighted.Length)]);
        }
        private void Select(Entry entry) {
            current = entry; revealed = settings.showMeaning;
            ResetClock(); RenderCard();
        }
        private void ResetClock() { deadline = DateTime.UtcNow.AddMinutes(settings.intervalMinutes); }
        private void Mark(string review) {
            if (current == null || current.kind != "word") return;
            var id = current.id;
            try {
                Data.Entries(list => {
                    var entry = list.Find(x => x.id == id);
                    if (entry != null) { entry.review = review; entry.reviewedAt = Data.Now(); }
                    return true;
                }, true);
                Reload(false);
                if (review == "again") Choose(true);
            } catch (Exception) { footLabel.Text = "这次复习没有保存。"; }
        }
        private void RenderCard() {
            var entry = current;
            bool word = entry != null && entry.kind == "word";
            bool hasMeaning = word && !string.IsNullOrEmpty(entry.meaning);
            stripe.BackColor = entry != null && !word ? Peach : Leaf;
            kindLabel.Text = entry == null ? "桌面卡片" : word ? "✦  单词与表达" : "◇  备忘";
            termLabel.Text = entry == null ? "等待第一条收藏" : entry.text;
            meaningLabel.Text = entry == null ?
                (entries.Any(Matches) ? "这一轮单词已复习完。" : "在 TikTok 记单词或备忘后，就会出现在这里。") :
                !word ? "" : !hasMeaning ? "暂无释义 · 可在收藏页补写或重试" : revealed ? entry.meaning : "";
            termLabel.Height = (entry != null && !word ? meaningLabel.Bottom : meaningLabel.Top) - termLabel.Top;
            revealButton.Visible = hasMeaning;
            revealButton.Text = revealed ? "隐藏释义" : "看释义";
            againButton.Visible = word;
            knownButton.Visible = word;
            nextButton.Visible = entry != null;
            footLabel.Text = readError ? "暂时无法读取收藏" :
                (settings.display == "word" ? "只看单词" : settings.display == "note" ? "只看备忘" : "全部") +
                "  ·  每 " + settings.intervalMinutes + " 分钟轮换";
            tip.SetToolTip(termLabel, entry == null ? "" : entry.text);
            tip.SetToolTip(meaningLabel, meaningLabel.Text);
        }
        private void HideCard() { Hide(); }
        private void ShowCard() { Show(); ResetClock(); }
        private void ShowMenuAt(Point location) { menu.Show(this, location); }
        private void AddChoice(ToolStripMenuItem parent, string title, bool selected, Action action) {
            var item = new ToolStripMenuItem(title) { Checked=selected };
            item.Click += delegate { action(); };
            parent.DropDownItems.Add(item);
        }
        private void BuildMenu() {
            while (menu.Items.Count > 0) {
                var old = menu.Items[0];
                menu.Items.RemoveAt(0);
                old.Dispose();
            }
            menu.Items.Add(Visible ? "收起到托盘" : "显示卡片", null, delegate { if (Visible) HideCard(); else ShowCard(); });
            var display = new ToolStripMenuItem("显示内容");
            AddChoice(display, "全部", settings.display == "all", delegate { SetFilter("all"); });
            AddChoice(display, "只看单词", settings.display == "word", delegate { SetFilter("word"); });
            AddChoice(display, "只看备忘", settings.display == "note", delegate { SetFilter("note"); });
            menu.Items.Add(display);
            var frequency = new ToolStripMenuItem("轮换间隔");
            foreach (var value in new[]{1,5,10,30}) {
                int minutes = value;
                AddChoice(frequency, minutes + " 分钟", settings.intervalMinutes == minutes,
                    delegate { settings.intervalMinutes = minutes; ResetClock(); RenderCard(); SaveSettings(); });
            }
            menu.Items.Add(frequency);
            var meaning = new ToolStripMenuItem("默认显示释义") { Checked=settings.showMeaning };
            meaning.Click += delegate {
                settings.showMeaning = !settings.showMeaning; revealed = settings.showMeaning;
                RenderCard(); SaveSettings();
            };
            menu.Items.Add(meaning);
            menu.Items.Add(new ToolStripSeparator());
            menu.Items.Add("导入 ECDICT 词典…", null, delegate { ImportDictionary(); });
            menu.Items.Add("设置本机模型…", null, delegate { ConfigureModel(); });
            menu.Items.Add("退出桌面组件", null, delegate { quitting = true; Close(); });
        }
        private void SetFilter(string mode) { settings.display = mode; Choose(false); SaveSettings(); }
        private void ImportDictionary() {
            using (var picker = new OpenFileDialog { Title="选择已解压的 ECDICT SQLite 词典",
                Filter="SQLite 词典 (*.db;*.sqlite;*.sqlite3)|*.db;*.sqlite;*.sqlite3|所有文件|*.*" }) {
                if (picker.ShowDialog() != DialogResult.OK) return;
                try {
                    DictionaryDb.Import(picker.FileName);
                    footLabel.Text = "已导入 · 旧词可在收藏页重新查释义";
                } catch (Exception) {
                    MessageBox.Show("无法导入。请选择 ECDICT 的 SQLite 数据库文件。", "随手收",
                        MessageBoxButtons.OK, MessageBoxIcon.Warning);
                }
            }
        }
        private void ConfigureModel() {
            using (var dialog = new Form {
                Text="本机模型 · 随手收", Font=Font, ClientSize=new Size(370, 150),
                StartPosition=FormStartPosition.CenterScreen, FormBorderStyle=FormBorderStyle.FixedDialog,
                MaximizeBox=false, MinimizeBox=false, TopMost=true
            }) {
                var title = new Label {Text="填写 Ollama 中已下载的模型名。留空则关闭。", Bounds=new Rectangle(12,12,345,25)};
                var input = new TextBox {Text=settings.model, MaxLength=96, Bounds=new Rectangle(12,42,345,26),
                    AccessibleName="Ollama 模型名称"};
                var note = new Label {Text="仅在本地词典没查到时调用。备忘不会送去查释义。", Bounds=new Rectangle(12,72,345,28)};
                var ok = new Button {Text="保存", Bounds=new Rectangle(208,106,72,29), DialogResult=DialogResult.OK};
                var cancel = new Button {Text="取消", Bounds=new Rectangle(286,106,72,29), DialogResult=DialogResult.Cancel};
                dialog.Controls.AddRange(new Control[]{title,input,note,ok,cancel});
                dialog.AcceptButton=ok; dialog.CancelButton=cancel;
                if (dialog.ShowDialog() != DialogResult.OK) return;
                string model = input.Text.Trim();
                if (model.Length != 0 && !Definitions.ValidModel(model)) {
                    MessageBox.Show("请输入 Ollama 中已下载的本地模型名称。", "随手收"); return;
                }
                settings.model=model;
                SaveSettings();
            }
        }
        protected override void Dispose(bool disposing) {
            if (disposing) {
                if (timer != null) timer.Dispose();
                if (tray != null) { tray.Visible=false; tray.Dispose(); }
                if (menu != null) menu.Dispose();
                tip.Dispose();
            }
            base.Dispose(disposing);
        }
    }
}

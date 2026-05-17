// プレイヤー用の状態管理
let currentMidi = null;
let updateTimerId = null; 
let currentNotes = [];      // ★ ソート済みのノートデータを保持するグローバル配列
let noteElements = [];      // ★ 楽譜に描画された音譜のDOM要素を保持するグローバル配列

// --- 音源とエフェクトの定義 ---
const reverb = new Tone.Reverb(1.5).toDestination();

// ① 生ピアノサンプラー
const piano = new Tone.Sampler({
    urls: { 
        "A1": "A1.mp3", 
        "A2": "A2.mp3", 
        "A3": "A3.mp3", 
        "A4": "A4.mp3" 
    },
    baseUrl: "https://tonejs.github.io/audio/salamander/",
    onload: () => console.log("[音源ログ] 生ピアノ音源の読み込みが完了しました")
}).connect(reverb);

// ② シンセサイザー
const polySynth = new Tone.PolySynth(Tone.Synth, {
    oscillator: { type: "triangle" },
    envelope: { attack: 0.05, decay: 0.3, sustain: 0.4, release: 0.8 }
}).connect(reverb);

// UI要素の取得
const fileInput = document.getElementById('file-input');
const fileNameDisplay = document.getElementById('file-name');
const playBtn = document.getElementById('play-btn');
const pauseBtn = document.getElementById('pause-btn');
const stopBtn = document.getElementById('stop-btn');
const progressBar = document.getElementById('progress-bar');
const volumeSlider = document.getElementById('volume-slider');
const currentTimeDisplay = document.getElementById('current-time');
const totalTimeDisplay = document.getElementById('total-time');

// 音量変更
if (volumeSlider) {
    volumeSlider.addEventListener('input', (e) => {
        Tone.Destination.volume.value = parseFloat(e.target.value);
    });
}

// 時間フォーマット変換 (秒 -> m:ss)
function formatTime(seconds) {
    if (isNaN(seconds) || seconds < 0) return "0:00";
    const min = Math.floor(seconds / 60);
    const sec = Math.floor(seconds % 60);
    return `${min}:${String(sec).padStart(2, '0')}`;
}

// 1. MIDIファイル選択時の処理
if (fileInput) {
    fileInput.addEventListener('change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;

        if (fileNameDisplay) fileNameDisplay.textContent = file.name;

        console.log(`[ファイル選択] ファイル名: ${file.name}`);
        resetPlayback();

        const reader = new FileReader();
        reader.onload = async (event) => {
            const arrayBuffer = event.target.result;
            
            try {
                if (typeof Midi !== 'undefined' && Midi.fromArrayBuffer) {
                    currentMidi = Midi.fromArrayBuffer(arrayBuffer);
                } else {
                    currentMidi = new Midi(arrayBuffer);
                }
                
                console.log("[MIDIパース成功]", currentMidi);

                // トラック0のノートデータを時間順にソートしてグローバルにキャッシュ
                if (currentMidi.tracks && currentMidi.tracks.length > 0) {
                    currentNotes = [...currentMidi.tracks[0].notes].sort((a, b) => a.time - b.time);
                    console.log(`[データログ] トラック0から ${currentNotes.length} 個のノートを抽出・ソートしました。`);
                } else {
                    currentNotes = [];
                    console.warn("[データ警告] MIDIにトラック、またはノートデータが含まれていません。");
                }

                const duration = currentMidi.duration || 0;
                if (totalTimeDisplay) totalTimeDisplay.textContent = formatTime(duration);
                if (progressBar) {
                    progressBar.max = duration;
                    progressBar.value = 0;
                }

                // 譜面の描画
                renderScoreFromMidi(currentMidi);

                // 再生トラックのスケジュール登録
                setupMidiTransport();

                if (playBtn) playBtn.disabled = false;
                if (stopBtn) stopBtn.disabled = false;
                if (pauseBtn) pauseBtn.disabled = true;

            } catch (error) {
                console.error("[解析エラー]", error);
                alert("MIDIファイルの解析に失敗しました。");
            }
        };
        reader.readAsArrayBuffer(file);
    });
}

// 譜面描画関数
function renderScoreFromMidi(midi) {
    if (typeof ABCJS === 'undefined') {
        console.error("[ABCJSエラー] ABCJSライブラリが読み込まれていません。");
        return;
    }

    let meter = "4/4";
    if (midi.header.timeSignatures && midi.header.timeSignatures.length > 0) {
        const ts = midi.header.timeSignatures[0];
        meter = `${ts.numerator}/${ts.denominator}`;
    }

    let bpm = 120;
    if (midi.header.tempos && midi.header.tempos.length > 0) {
        bpm = Math.round(midi.header.tempos[0].bpm);
    }

    let key = "C";
    if (midi.header.keySignatures && midi.header.keySignatures.length > 0) {
        key = midi.header.keySignatures[0].key;
    }

    const midiToAbc = (midiNum) => {
        const notes = ['C', '^C', 'D', '^D', 'E', 'F', '^F', 'G', '^G', 'A', '^A', 'B'];
        const octave = Math.floor(midiNum / 12);
        const noteName = notes[midiNum % 12];
        
        if (octave === 4) return noteName; 
        if (octave === 5) return noteName.toLowerCase(); 
        if (octave < 4) return noteName + ",".repeat(4 - octave); 
        return noteName.toLowerCase() + "'".repeat(octave - 5); 
    };

    let noteText = "";
    currentNotes.forEach(note => {
        noteText += midiToAbc(note.midi) + " ";
    });

    if (!noteText) noteText = "Z8";

    const dynamicAbc = `X:1\nT:${midi.header.name || "Imported MIDI"}\nM:${meter}\nQ:1/4=${bpm}\nK:${key}\nL:1/8\n| ${noteText} |`;
    
    // 楽譜描画を実行 ★ add_classes: true を追加！
    ABCJS.renderAbc("paper", dynamicAbc, { 
        responsive: "resize", 
        add_classes: true 
    });
    console.log("[ABCJS描画] 楽譜のレンダリングが完了しました。");

    // ★ これでクラス名が出力され、音符要素が正常に取得できるようになります
    noteElements = Array.from(document.querySelectorAll('#paper .abcjs-note'));
    console.log(`[DOMログ] 画面上の音符要素(.abcjs-note)を ${noteElements.length} 個検出・保存しました。`);

    if (noteElements.length === 0) {
        console.error("[DOMエラー] 楽譜の音符要素が1つも取得できませんでした。HTML構造、またはクラス名が異なる可能性があります。");
    }
}

// 再生状態のリセット
function resetPlayback() {
    Tone.Transport.stop();
    Tone.Transport.cancel();
    if (updateTimerId !== null) {
        Tone.Transport.clear(updateTimerId);
        updateTimerId = null;
    }
    
    // ハイライトクリア
    if (noteElements.length > 0) {
        noteElements.forEach(el => el.classList.remove("abcjs-highlight"));
    }
    currentNotes = [];
    noteElements = [];

    if (progressBar) progressBar.value = 0;
    if (currentTimeDisplay) currentTimeDisplay.textContent = "0:00";
    if (playBtn) playBtn.disabled = true;
    if (pauseBtn) pauseBtn.disabled = true;
    if (stopBtn) stopBtn.disabled = true;
    console.log("[リセット] 再生状態とキャッシュをクリアしました。");
}

// 再生タイムラインの構築
function setupMidiTransport() {
    if (!currentMidi || currentNotes.length === 0) return;

    const instrumentSelect = document.getElementById('instrument-select');
    const midiEvents = [];

    currentNotes.forEach(note => {
        midiEvents.push({
            time: note.time,
            name: note.name,
            duration: note.duration,
            velocity: note.velocity
        });
    });

    new Tone.Part((time, event) => {
        const selectedType = instrumentSelect ? instrumentSelect.value : 'piano';
        if (selectedType === 'piano') {
            piano.triggerAttackRelease(event.name, event.duration, time, event.velocity);
        } else {
            polySynth.triggerAttackRelease(event.name, event.duration, time, event.velocity);
        }
    }, midiEvents).start(0);

    // プログレスバーとハイライトのタイマー（100ms周期）
    updateTimerId = Tone.Transport.scheduleRepeat(() => {
        const currentSeconds = Tone.Transport.seconds;
        if (progressBar) progressBar.value = currentSeconds;
        if (currentTimeDisplay) currentTimeDisplay.textContent = formatTime(currentSeconds);
        
        // ★ ハイライト関数の呼び出し
        updateScoreHighlight(currentSeconds);
        
        if (currentSeconds >= currentMidi.duration) {
            handleStop();
        }
    }, 0.1);
    console.log("[タイマー登録] 100ms周期の同期タイマーを起動しました。");
}

// ★ ハイライト同期処理（ログ強化版）
let lastActiveIndex = -1; // ログが溢れるのを防ぐためのトリガー変数
function updateScoreHighlight(currentSeconds) {
    if (currentNotes.length === 0 || noteElements.length === 0) {
        // ここで引っかかっている場合、そもそもデータかDOMがありません
        return;
    }

    // 現在時間に対応するノートのインデックスを検索
    let activeIndex = -1;
    for (let i = 0; i < currentNotes.length; i++) {
        if (currentNotes[i].time <= currentSeconds) {
            activeIndex = i;
        } else {
            break; 
        }
    }

    // 音が変わった瞬間だけコンソールに詳細を出力（ログの埋め尽くし防止）
    if (activeIndex !== lastActiveIndex) {
        console.log(`[同期ログ] 再生秒数: ${currentSeconds.toFixed(2)}s -> 現在の音符インデックス: ${activeIndex}`);
        lastActiveIndex = activeIndex;

        // 全てのハイライトをリセット
        noteElements.forEach(el => el.classList.remove("abcjs-highlight"));

        if (activeIndex !== -1) {
            const activeTime = currentNotes[activeIndex].time;
            let highlightedCount = 0;

            // 同時刻の音（和音など）をまとめてハイライト
            for (let i = 0; i < currentNotes.length; i++) {
                if (Math.abs(currentNotes[i].time - activeTime) < 0.01) {
                    if (noteElements[i]) {
                        noteElements[i].classList.add("abcjs-highlight");
                        highlightedCount++;
                    } else {
                        console.warn(`[同期警告] インデックス ${i} のノートに対応するDOM要素が存在しません。`);
                    }
                }
            }
            console.log(`[DOM操作] クラス 'abcjs-highlight' を ${highlightedCount} 個の音符要素に付与しました。`);
        }
    }
}

// 2. 再生ボタン
if (playBtn) {
    playBtn.addEventListener('click', async () => {
        await Tone.start();
        Tone.Transport.start();
        playBtn.disabled = true;
        if (pauseBtn) pauseBtn.disabled = false;
        console.log("[操作] 再生を開始しました。");
    });
}

// 3. 一時停止ボタン
if (pauseBtn) {
    pauseBtn.addEventListener('click', () => {
        Tone.Transport.pause();
        if (playBtn) playBtn.disabled = false;
        pauseBtn.disabled = true;
        console.log("[操作] 一時停止しました。");
    });
}

// 4. 停止ボタン
if (stopBtn) {
    stopBtn.addEventListener('click', () => {
        handleStop();
    });
}

function handleStop() {
    Tone.Transport.stop();
    if (progressBar) progressBar.value = 0;
    if (currentTimeDisplay) currentTimeDisplay.textContent = "0:00";
    
    if (noteElements.length > 0) {
        noteElements.forEach(el => el.classList.remove("abcjs-highlight"));
    }
    lastActiveIndex = -1;

    if (playBtn) playBtn.disabled = false;
    if (pauseBtn) pauseBtn.disabled = true;
    console.log("[操作] 再生を停止し、ハイライトをクリアしました。");
}

// シークバー操作
if (progressBar) {
    progressBar.addEventListener('input', (e) => {
        if (!currentMidi) return;
        const seekTo = parseFloat(e.target.value);
        Tone.Transport.seconds = seekTo;
        if (currentTimeDisplay) currentTimeDisplay.textContent = formatTime(seekTo);
        
        // シーク時も即座に同期
        updateScoreHighlight(seekTo);
    });
}
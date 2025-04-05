const TSV_FILE = './quiz_data.tsv';
const nextQuestionBtn = document.getElementById('next-question-btn');
const showAnswerBtn = document.getElementById('show-answer-btn');
const questionArea = document.getElementById('question-area');
const volumeSlider = document.getElementById('volume-slider');
const volumeLabel = document.getElementById('volume-label');

let config = {};
let quizData = [];
let currentQuestion = null;
let nextQuestion = null;
let prevAudioUrl = null;
let nextAudioUrl = null;
let audio = null;
let isAudioReady = false;  // 音声合成が完了したかどうか
let isAnswerShown = false; // 問題と回答が表示されたかどうか
let isFirstLoad = true;    // 初回読み込み時かどうか
let isPaused = false;  // 一時停止状態を管理

async function loadConfig() {
    const response = await fetch('./config.json');
    config = await response.json();
    console.log('設定読み込み完了:', config);
}

// 表示用： [表示|読み] → 表示
function extractDisplayText(text) {
    return text.replace(/\[([^\|\[\]]+)\|([^\[\]]+)\]/g, '$1');
}

// 合成用： [表示|読み] → 読み
function extractReadingText(text) {
    return text.replace(/\[([^\|\[\]]+)\|([^\[\]]+)\]/g, '$2');
}

// TSVファイル一覧を取得
async function fetchTSVList() {
    const FILE_LIST_URL = `http://localhost:${config.server.port}/list_questions`;

    try {
        const response = await fetch(FILE_LIST_URL);
        if (!response.ok) throw new Error(`サーバーエラー: ${response.status}`);

        const data = await response.json();
        console.log(`${data.files.length} 件のTSVファイルを検出しました`);
        return data.files;
    } catch (error) {
        console.error(`❌ TSVリスト取得失敗: ${error}`);
        return [];
    }
}

// TSVファイルを個別にfetchして読み込む
async function loadTSVFiles() {
    const files = await fetchTSVList();

    for (const file of files) {
        await fetchTSV(file);
    }
    console.log(`${quizData.length} 件のクイズを統合しました`);
}

// TSVファイルをfetchしてパース
async function fetchTSV(file) {
    const FILE_URL = `./questions/${file}`;

    try {
        const response = await fetch(FILE_URL, { cache: "no-store" });
        if (!response.ok) throw new Error(`ファイル読み込みエラー: ${response.status}`);

        const text = await response.text();
        const rows = text.trim().split('\n');
        const headers = rows.shift().split('\t');

        for (const row of rows) {
            const cols = row.split('\t');
            if (cols.length >= 3) {
                const question = cols[0];
                const answer = cols[1];
                const note = cols[2];

                quizData.push({
                    question,
                    answer,
                    note
                });
            }
        }
    } catch (error) {
        console.error(`❌ TSV取得失敗: ${error}`);
    }
}

// 音声を再生・再開
function playAudio() {
    if (!audio) {
        audio = new Audio(nextAudioUrl);
    }
    // 🔹 スライダーの値に基づいて音量を調整
    audio.volume = parseFloat(volumeSlider.value);

    // 🔹 再生 / 停止の切り替え
    if (audio.paused) {
        audio.play().catch((error) => {
            console.error("❌ 再生エラー:", error);
        });
        console.log("▶️ 再生開始");
        isPaused = false;
    } else {
        audio.pause(); // 一時停止
        console.log("⏸️ 一時停止");
        isPaused = true;
    }

    // 🔹 音声が終了したらフラグをリセット
    audio.onended = () => {
        console.log("音声再生完了");
        isPaused = false;
    };
}

// 音声合成リクエスト (クライアントがファイル名を指定)
async function synthesizeQuestion(question, filename) {
    const VOICEPEAK_URL = `http://localhost:${config.server.port}/synthesize`;

    await fetch(VOICEPEAK_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: question, filename: filename })
    });
}

// 音声合成状態確認API
async function checkSynthesizeStatus(filename) {
    const STATUS_URL = `http://localhost:${config.server.port}/synthesize_status/${filename}`;
    try {
        const response = await fetch(STATUS_URL);
        if (!response.ok) return null;
        const result = await response.json();
        return result.status;
    } catch {
        return null;
    }
}

// 音声合成ファイルを削除
async function deleteAudioFile(filename) {
    if (!filename) return;
    const DELETE_URL = `http://localhost:${config.server.port}/delete_audio/${filename}`;
    try {
        const response = await fetch(DELETE_URL, { method: 'DELETE' });
        if (response.ok) {
            console.log(`ファイル削除成功: ${filename}`);
        }
    } catch (error) {
        console.error(`❌ ファイル削除失敗: ${error}`);
    }
}

// 音声ファイル一括削除
async function cleanupAudioFiles() {
    const DELETE_URL = `http://localhost:${config.server.port}/cleanup_audio`;
    try {
        const response = await fetch(DELETE_URL, { method: 'DELETE' });
        if (response.ok) {
            console.log(`音声ファイルを一括削除しました。`);
        }
    } catch (error) {
        console.error(`❌ クリーンアップ失敗: ${error}`);
    }
}

// 事前に音声合成を実行
async function preloadNextQuestion() {
    nextQuestionBtn.disabled = true;
    nextQuestion = getNextQuestionData();
    if (nextQuestion) {
        const filename = `${Date.now()}.wav`;
        prevAudioUrl = nextAudioUrl;
        nextAudioUrl = `./output/${filename}`;
        console.log(`🎯 事前合成開始`);

        isAudioReady = false; // 音声合成フラグをリセット

        // 非同期で音声合成開始const rawText = currentQuestion.question;
        synthesizeQuestion("問題。" + extractReadingText(nextQuestion.question), filename);

        // 🔄 ポーリングでファイル確認
        const interval = setInterval(async () => {
            const status = await checkSynthesizeStatus(filename);
            if (status == "completed") {
                console.log(`合成完了: ${nextAudioUrl}`);
                isAudioReady = true;
                clearInterval(interval);
                // 初回は音声合成完了だけでボタンを有効化
                if (isFirstLoad) {
                    console.log("初回合成完了 → ボタン有効化");
                    nextQuestionBtn.disabled = false;
                } else {
                    updateNextButtonState(); // 初回以外は通常の条件でボタンを有効化
                }
            }
        }, 500); // 🔄 500ms間隔でチェック
    }
}


// 「次の問題」ボタンがクリックされたとき
async function handleNextQuestion() {
    if (!nextAudioUrl) return;

    // 以前の音声ファイルを削除
    if (prevAudioUrl) {
        const filename = prevAudioUrl.split('/').pop(); // パスからファイル名を抽出
        await deleteAudioFile(filename);
        prevAudioUrl = null;
    }

    nextQuestionBtn.disabled = true;
    currentQuestion = nextQuestion;
    questionArea.innerText = "";

    if (audio) {
        audio.pause();
        audio = null;
    }

    audio = new Audio(nextAudioUrl);
    audio.volume = parseFloat(volumeSlider.value); // 初期音量設定
    audio.play();

    preloadNextQuestion();

    audio.onended = () => {
        console.log("音声再生完了");
    };

    isAnswerShown = false; // 表示フラグをリセット

    // 初回のボタンクリック時にフラグを false に
    if (isFirstLoad) {
        isFirstLoad = false;
        console.log("初回完了 → フラグをfalseに");
    }
    updateNextButtonState(); // ボタン状態を更新
}

// 「問題と回答を表示」ボタンがクリックされたとき
function showAnswer() {
    if (currentQuestion) {
        questionArea.innerText =
            `問題: ${currentQuestion.question}\n\n解答: ${currentQuestion.answer}\n\n備考: ${currentQuestion.note}`;
        isAnswerShown = true; // 表示フラグを有効化
        updateNextButtonState(); // ボタン有効化チェック
    }
}

// 次の問題をランダムに取得
function getNextQuestionData() {
    if (quizData.length === 0) return null;
    return quizData[Math.floor(Math.random() * quizData.length)];
}

// 「次の問題」ボタンの有効化を判定
function updateNextButtonState() {
    if (isFirstLoad) {
        // 初回は音声合成が終われば有効化
        nextQuestionBtn.disabled = false;
    } else if (isAudioReady && isAnswerShown) {
        nextQuestionBtn.disabled = false;
        console.log("次の問題ボタンが有効化されました");
    } else {
        nextQuestionBtn.disabled = true;
        console.log("⏳ 条件未達成: ボタン無効化");
    }
}

// イベントハンドラ登録
nextQuestionBtn.addEventListener('click', handleNextQuestion);
// showAnswerBtn.addEventListener('click', showAnswer);

// ページ読み込み時にデータ読み込みと初回音声合成を連携
window.onload = async () => {
    console.log("🚀 アプリ起動");
    await loadConfig();
    await cleanupAudioFiles();
    await loadTSVFiles(); // クイズデータの読み込みが完了するまで待つ
    await preloadNextQuestion(); // 読み込み完了後に音声合成を開始
    updateVolumeLabel(); // 音量ラベルを更新
    // 初期表示テキストを薄く
    questionArea.classList.add('placeholder-text');
};

// スペースキーで再生 / 一時停止
document.addEventListener('keydown', (e) => {
    if (e.code === 'Space') {
        e.preventDefault();

        if (audio) {
            playAudio(); // 既存の音声を再生・一時停止
        }
    }
});

// 「問題と回答を表示」ボタンを押したとき
showAnswerBtn.addEventListener('click', () => {
    if (currentQuestion) {
        const googleSearchUrl = `https://www.google.com/search?q=${encodeURIComponent(currentQuestion.answer)}`;

        // innerHTML でリンクを生成
        questionArea.innerHTML = `
            <p>問題: ${extractDisplayText(currentQuestion.question)}</p>
            <p>
                解答: ${currentQuestion.answer}
                （<a href="${googleSearchUrl}" target="_blank" rel="noopener noreferrer">Google検索</a>）
            </p>
            <p>備考: ${currentQuestion.note}</p>
        `;

        // 実際の問題・解答表示時に色を元に戻す
        questionArea.classList.remove('placeholder-text');

        isAnswerShown = true;
        updateNextButtonState();
    }
});

// 音量をリアルタイムで調整
volumeSlider.addEventListener('input', () => {
    if (audio) {
        audio.volume = parseFloat(volumeSlider.value);
        updateVolumeLabel();
    }
});

// 音量ラベルを更新
function updateVolumeLabel() {
    const percentage = Math.round(volumeSlider.value * 100);
}
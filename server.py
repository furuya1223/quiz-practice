from fastapi import FastAPI, HTTPException
from pydantic import BaseModel
import subprocess
import os
import threading
import json
import glob

# 設定ファイルを読み込む
with open("config.json", "r", encoding="utf-8") as file:
    config = json.load(file)

# 設定の読み込み
VOICEPEAK_PATH = config["voicepeak_path"]
SPEAKER = config["voicepeak_speaker"]
SERVER_HOST = config["server"]["host"]
SERVER_PORT = config["server"]["port"]

OUTPUT_DIR = "output"
QUESTIONS_DIR = "questions"

os.makedirs(OUTPUT_DIR, exist_ok=True)

# 音声合成状態管理用
synthesize_status = {}

app = FastAPI()

class SynthesizeRequest(BaseModel):
    text: str
    filename: str

@app.post("/synthesize")
async def synthesize(request: SynthesizeRequest):
    if not request.text.strip():
        raise HTTPException(status_code=400, detail="テキストが空です")

    filepath = os.path.join(OUTPUT_DIR, request.filename)
    synthesize_status[request.filename] = "in_progress"

    def run_synthesis():
        # VoicePeakで音声生成コマンドを実行
        command = [
            VOICEPEAK_PATH,
            "-n", SPEAKER,
            "-s", request.text,
            "-o", filepath
        ]
        try:
            result = subprocess.run(command, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            if result.returncode == 0:
                synthesize_status[request.filename] = "completed"
            else:
                synthesize_status[request.filename] = "failed"
        except Exception as e:
            synthesize_status[request.filename] = "failed"
            print(f"音声合成エラー: {str(e)}")

    # バックグラウンドで合成実行
    threading.Thread(target=run_synthesis).start()

    return {"status": "started"}

# 合成状態を問い合わせるAPI
@app.get("/synthesize_status/{filename}")
async def get_synthesize_status(filename: str):
    status = synthesize_status.get(filename)
    if status is None:
        raise HTTPException(status_code=404, detail="ファイルが存在しません")
    return {"status": status}

# 音声ファイルを削除するAPI
@app.delete("/delete_audio/{filename}")
async def delete_audio(filename: str):
    filepath = os.path.join(OUTPUT_DIR, filename)
    if os.path.exists(filepath):
        try:
            os.remove(filepath)
            synthesize_status.pop(filename, None)  # 状態からも削除
            return {"status": "deleted"}
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"削除失敗: {str(e)}")
    else:
        raise HTTPException(status_code=404, detail="ファイルが存在しません")

# ディレクトリ内の音声ファイルを一括削除
@app.delete("/cleanup_audio")
async def cleanup_audio():
    try:
        file_count = 0
        for file in glob.glob(os.path.join(OUTPUT_DIR, "*.wav")):
            os.remove(file)
            file_count += 1

        print(f"{file_count} 個の音声ファイルを削除しました。")
        return {"deleted_files": file_count}

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"クリーンアップ失敗: {str(e)}")

# TSVファイル一覧取得API
@app.get("/list_questions")
async def list_questions():
    try:
        tsv_files = glob.glob(os.path.join(QUESTIONS_DIR, "*.tsv"))
        filenames = [os.path.basename(file) for file in tsv_files]
        if not filenames:
            raise HTTPException(status_code=404, detail="TSVファイルが見つかりません")
        return {"files": filenames}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"エラー: {str(e)}")


# CORSを許可
from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server:app", host=SERVER_HOST, port=SERVER_PORT, reload=True)

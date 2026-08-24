#!/bin/sh
# 더블클릭하면 로컬 서버가 뜨고 브라우저가 열립니다. 끄려면 이 창에서 Control-C.
cd "$(dirname "$0")"
PORT=8000
while lsof -nP -iTCP:$PORT -sTCP:LISTEN >/dev/null 2>&1; do
  PORT=$((PORT+1))
done
echo ""
echo "  Metron  →  http://localhost:$PORT"
echo "  끄려면 Control-C"
echo ""
( sleep 1; open "http://localhost:$PORT" ) &
python3 -m http.server $PORT

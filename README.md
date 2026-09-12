# 數獨筆記本 Sudoku Notebook

極簡、快速的網頁版數獨。單人模式,三種難度各 100 題(依實際解題技巧分級,不只是看給定格數),
內建鉛筆筆記、提示(每局 3 次)、計時與關卡進度。純前端、免安裝、可離線玩,適合 PC、筆電、
iPad、手機。詳細規格見 [SPEC.md](SPEC.md)。

## 本機執行
不需要安裝任何套件,任何靜態伺服器都可以,例如:

```bash
python -m http.server 5173
```

然後打開 http://localhost:5173

## 重新產生題庫
題庫是離線預先產生好的(`data/puzzles.js`),一般不需要重跑。如果要調整難度技巧或題目數量:

```bash
node tools/generate-puzzles.js
```

## 部署
純靜態網站,推到 GitHub 後在 repo 設定開啟 GitHub Pages(分支 `main`,路徑 `/root`)即可。

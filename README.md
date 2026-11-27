# 夜巷 · 横板

1987 年老城区夜巷，横板 2D 像素动作 Roguelite（S1 原型）。

守夜学徒提桃木剑一路向右，打穿随机生成的夜巷，尽头斩大心魔。世界观与原俯视角版《夜巷》相同，玩法重做：重力、跳跃、平台、手动挥剑、翻滚、冲刺攻击、蓄力重击。

试玩：https://zhuuchaofan.github.io/night-alley-sideview/

## 本地运行

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc + vite build
npx playwright test --workers=1   # E2E
```

## 操作

- A / D：左右跑
- K / 空格：跳跃（单跳）
- J：挥剑（按住蓄力，松手重劈）
- Shift：翻滚（0.3 秒无敌）
- L：冲刺攻击（穿敌）
- R：重开，Esc：回标题

## 部署

GitHub Pages 从 `gh-pages` 分支部署（构建产物）。更新试玩页：`npm run build` 后把 `dist/` 推到 `gh-pages` 分支。

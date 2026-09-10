# 隧道点云切片与轮廓提取

从 LAS 点云估计隧道轴线，按固定厚度切断面，提取内壁轮廓并拟合圆。默认轮廓算法是圆周 Hampel 去突刺。

坐标单位与 LAS 一致。当前示例 `490.las` 为局部米制坐标：断面大约 3 m 宽、2.5 m 高，轴线长约 32 m。程序不做额外缩放。

## 安装

需要 Python 3.11+ 和 [uv](https://docs.astral.sh/uv/)。

```powershell
cd C:\Users\Administrator\Desktop\pc
uv sync
```

之后一律用 `uv run tunnel-pc ...`。命令入口是 `tunnel_pc.cli`。交互三维页还需要 Node.js 18+（`viewer/`）。

## 交互三维（推荐先看这个）

点云在显示坐标系里被放平：横向为 X，重力向上为 Y（平底在下），沿轴线为 Z。真实隧道可以上坡下坡，画面里始终水平，平底朝下。

```powershell
cd C:\Users\Administrator\Desktop\pc\viewer
npm install
npm run build
cd ..
uv run tunnel-pc view 490.las --output output --port 8765
```

开发时也可前后端分开：

```powershell
uv run tunnel-pc view 490.las --output output --port 8765 --no-open-browser
cd viewer
npm run dev
```

浏览器打开 `http://127.0.0.1:8765`（打包后）或 Vite 的 `http://127.0.0.1:5173`。拖动透明切片看轮廓和拟合圆，可改算法与厚度；导出按钮会调用 Python 按当前参数重新出图。

## 推荐工作流

### 1. 查看点云范围

```powershell
uv run tunnel-pc inspect 490.las
```

输出点数、XYZ 最小/最大值、LAS 维度名。用这个确认单位和包围盒，再决定切片厚度。

### 2. 切片、提轮廓、拟合

```powershell
uv run tunnel-pc process 490.las --output output --thickness 0.20 --min-points 30
```

默认行为：

- 切片厚度 `--thickness 0.20`（米）
- 切片间隔等于厚度，沿轴线连续、不重叠：`[s, s+0.20)`
- 轮廓方法 `--contour-method hampel`
- 每个有点的仓位都会尝试提取；点数不足或角度覆盖不足的写入失败表

常用可选参数：

| 参数 | 默认 | 含义 |
| --- | --- | --- |
| `--thickness` | `0.20` | 轴向切片厚度，同时是步长 |
| `--min-points` | `30` | 切片最少点数 |
| `--contour-bins` | `180` | 极角分桶数 |
| `--min-contour-points` | `12` | 轮廓最少点数 |
| `--min-angular-coverage` | `0.5` | 角度覆盖下限（0–1） |
| `--contour-method` | `hampel` | 见下方算法列表 |
| `--smooth-window` | `9` | 奇数平滑窗口 |
| `--overview-max-points` | `100000` | 三维总览采样点数 |
| `--save-points` / `--no-save-points` | 保存 | 是否写出每片点云 CSV |

换算法示例：

```powershell
uv run tunnel-pc process 490.las --output output --contour-method robust
```

### 3. 看结果表

- 成功剖面：`output/summary/section_parameters.csv`
- 失败剖面：`output/summary/failed_sections.csv`
- 机器可读索引：`output/profile_manifest.json`

断面编号来自沿轴仓位下标，不是连续成功序号。例如成功片可能从 90 开始，中间失败片会缺号。

### 4. 二维出图（不再读 LAS）

```powershell
uv run tunnel-pc render output/profile_manifest.json 100 --layers full
uv run tunnel-pc render output/profile_manifest.json 100 --layers contour
uv run tunnel-pc render output/profile_manifest.json 100 --layers points
uv run tunnel-pc render output/profile_manifest.json 100 --layers points_contour
```

`--layers` 也可写成逗号组合，例如 `points,contour`。默认写到 `output/renders/section_XXXXXX_<layers>.png`。

只有 `summary/section_parameters.csv` 里出现的 `section_id` 才能出图。

### 5. 三维出图（不再读 LAS）

```powershell
uv run tunnel-pc render-section-3d output/profile_manifest.json 100
uv run tunnel-pc render-tunnel-3d output/profile_manifest.json 100
```

视角沿隧道轴向再偏约 45°，同时看到断面形状和隧道长度。默认输出：

- `output/renders/section_XXXXXX_3d.png`
- `output/renders/tunnel_slice_XXXXXX_3d.png`

### 6. 对比轮廓算法（不再读 LAS）

需要该片保存了点云 CSV（`process` 默认会保存）。

```powershell
uv run tunnel-pc compare-contours output/profile_manifest.json 100
uv run python -m tunnel_pc.compare_contours output/profile_manifest.json 100
```

写出六宫格 PNG 和指标 CSV：

- `output/comparisons/section_XXXXXX_methods.png`
- `output/comparisons/section_XXXXXX_methods.csv`

对比脚本在 `tunnel_pc/compare_contours.py`，只做 A/B，不改默认处理路径。

## 轮廓算法

| 名称 | 作用 |
| --- | --- |
| `legacy` | 极角分桶取高分位点，相邻点直接连线 |
| `statistical` | 邻域统计滤波后再做极角包络 |
| `radius` | 半径邻域滤波后再做极角包络 |
| `hampel`（默认） | 圆周 Hampel 去掉径向突刺，保留拱形 |
| `robust` | 统计滤波 + 半径滤波 + Hampel + 中值 + Savitzky–Golay |
| `spline` | 在 robust 基础上再做周期 B 样条，平滑过强时会把拱形拉圆 |

## 输出目录

```
output/
  profile_manifest.json
  axis_direction.json
  overview_points.csv
  sections/
    section_XXXXXX_points.csv
    section_XXXXXX_contour.csv
    section_XXXXXX.png
  summary/
    section_parameters.csv
    failed_sections.csv
  renders/
  comparisons/
```

剖面坐标：`u` 为隧道横向，`v` 向上。即使扫描仪原坐标有旋转，平底也会画在图的下方。

## 当前示例数据量级（490.las）

用默认参数跑过一次后的量级，便于核对比例尺：

- 点云约 562 万点，局部坐标，无 CRS
- 轴线长约 32 m；切片 0.20 m 厚、0.20 m 间隔
- 沿轴约 160 个仓位；有点的约 141 片；轮廓成功 67 片，失败 74 片
- 典型断面宽约 2.8–3.0 m、高约 2.5 m；拟合圆半径中位数约 1.44 m

# ECHO 学习型运动接口与研究记录

## 能力边界

本版建立了身体描述、连续姿态协议、实时执行和外部模型接入接口。插件没有内置学习型运动权重。未配置服务时，状态明确为 `unavailable`，不会把本地 IK、弹簧或待机运动标为 AI。

宿主 LLM 生成身体成长提案，与专门的模型生成连续骨骼运动，是两个独立能力。前者可用不代表后者已经接通。模型状态中的 ID 与权重摘要由服务声明；它们提供追溯信息，不证明训练质量、自然度或真实性。

## 接入方式

宿主配置 `lifeMotionEndpoint`，或设置 `ECHO_MOTION_ENDPOINT`，值只能是显式的本机回环 HTTP 端口，例如 `http://127.0.0.1:8765`。也接受 IPv6 回环地址。禁止远端地址、凭据、路径、查询参数和重定向；默认不连接任何服务。

模型服务实现以下两个端点：

| 模型服务 | 插件端点 | 作用 |
| --- | --- | --- |
| `GET /status` | `GET /dsh-music/api/life/motion` | 声明模型、支持的身体结构与能力 |
| `POST /generate` | `POST /dsh-music/api/life/motion/generate` | 根据当前身体与姿态生成短时轨迹 |

`/status` 的就绪响应：

```json
{
  "protocol": "echo-motion/1",
  "status": "ready",
  "model": {
    "kind": "learned",
    "id": "your-model-id",
    "version": "your-model-version",
    "weightsSha256": "实际权重文件的64位小写十六进制SHA256"
  },
  "supportedTopologies": ["feifei-quadruped/1"],
  "capabilities": [
    "body-conditioned",
    "pose-conditioned",
    "goal-conditioned",
    "continuous-motion"
  ]
}
```

只有真正支持上述条件的服务才应声明 `ready`。仅能生成任意动物运动、选择动画片段或返回程序化曲线的服务，不能填写这些能力声明后当成完成接入。

## 请求与姿态约定

`POST /generate` 接收：

| 字段 | 含义 |
| --- | --- |
| `protocol` | 固定 `echo-motion/1` |
| `requestId` | 本次生成请求的唯一标识 |
| `body` | 身体 schema 2，含 `lifeId/lifeRevision/bodyRevision/contentId/species/topology/parameters/descriptor` |
| `state.time` | 当前运行时间，秒；不是轨迹相对时间 |
| `state.root` | 身体坐标中的绝对根位置 `[x,y,z]`，包含根关节静止高度 |
| `state.rotations` | 每个语义关节的局部、相对静止姿态四元数 `[x,y,z,w]` |
| `state.contacts` | 当前接地的接触点 ID 数组 |
| `goal` | `{target:[x,y,z],attention:0..1,energy:0..1}` |
| `music` | `energy/brightness/rhythm/texture` 四个 0..1 数值；当前是 DSP 观察值，`rhythm` 不是 BPM |
| `style` | 有界的个体风格数值对象；不是动画名称 |

坐标为 **+X 向前、+Y 向上、+Z 向左**。`body.descriptor.skeleton.joints` 包含关节 ID、父关节、静止偏移和局部 Euler XYZ 弧度限制；运动输出使用四元数。身体尺寸参数采用身体单位，不能误当全部为 0..1。

宿主重新读取已提交的身体，替换请求中携带的身体描述后再调用模型。客户端不能通过运动请求提交新身体。普通聆听事件只更新 `lifeRevision` 时不会使当前运动失效；身份、身体版本、结构或内容 ID 改变则使旧结果失效。

## 轨迹响应

服务返回 `protocol/requestId/lifeId/bodyRevision/topology/model`，以及 `frames` 数组。每个 frame 包含 `time/root/rotations/contacts`，所有关节都必须提供旋转。

- `frames[0].time` 必须为 0；其余时间以秒递增，相对于这一段轨迹的开始。
- 首帧需要接续请求姿态。模型推理期间身体仍可能运动，渲染端还必须从实际当前姿态平滑接入。
- 最多 121 帧、2 秒；帧间隔 1–120 毫秒。
- 只接受有限数、单位四元数、已知关节和已知接触点。
- 检查关节范围、起点连续性和粗粒度速度突变。
- 拒绝 `clip/clipId/animation/animationId/play` 动画选择响应。
- 返回的模型版本及权重摘要必须与开始生成时的声明一致。

以上校验不等于物理正确性证明。脚底滑动、自碰撞、全身协调、长期自然度和设备性能仍需模型评测与实时约束共同保证。

## 运行与取消

`createMotionProvider()` 返回 `getSnapshot/subscribe/refreshStatus/generate/dispose`。默认不可用，`refreshStatus()` 才检查模型；没有自动轮询。

`generate(request, {signal})` 支持单次请求取消。多个视图共享一个 provider，最多同时生成一段；其他请求得到 `MOTION_BUSY`。隐藏或卸载一个视图只取消它自己的请求，不能销毁整个 provider。共享 provider 由生命服务统一释放。

宿主默认模型请求超时 2 秒、客户端默认 2.5 秒。输入上限 256 KiB，结果上限 2 MiB。响应采用流式大小限制。研究模型若无法满足这一延迟预算，不应通过增加无限等待来阻塞桌面交互。

## AnyTop 研究核对（2026-11-23）

查阅的原始来源：

- [AnyTop 官方代码](https://github.com/Anytop2025/Anytop)
- [AnyTop 官方预训练文件与说明](https://huggingface.co/inbar2344/AnyTop)
- [权重许可](https://huggingface.co/inbar2344/AnyTop/blob/main/LICENSE)
- [AnyTop 论文](https://arxiv.org/abs/2502.17327)
- [AniMo 官方代码](https://github.com/WandererXX/AniMo)

AnyTop 代码采用 MIT，但模型仓库明确将权重和派生数据限定为非商业研究使用。不能把源代码许可当成权重可商用的证明。本项目未将这些权重、条件数据或 T5 文件加入仓库或插件包。

已核实官方四足 checkpoint 可下载，单文件 9,222,606 字节；包含 2,291,098 个模型参数。它依赖 T5-base 的 768 维关节名称表示。官方 `cond.npy` 包含骨架、静止姿态、归一化统计等，没有缓存这些名称向量。不能使用全零向量代替后宣称成功复现。

研究验证使用独立 CPU 环境，相关依赖不进入插件：Python 3.12、PyTorch 2.6.0+cpu、Transformers 4.46.3、SentencePiece 0.2.1、Safetensors 0.4.5。脚本为 `scripts/motion/validate-anytop-cpu.py`。它使用 `weights_only=True` 加载 checkpoint，先核对 SHA256，再用只允许 NumPy 数据类型的反序列化器读取条件字典；T5 从本地 safetensors 加载。

已核对的文件：

| 文件 | 官方仓库路径 | SHA256 |
| --- | --- | --- |
| 四足模型 | `checkpoints/quadropeds_model_dataset_truebones_bs_16_latentdim_128/model000189999.pt` | `daf581e4fc8e601b32940e39fb24ef8cfdbf8fd3612ef9a75d1b4c7795b99afb` |
| 骨架条件 | `dataset/truebones/zoo/truebones_processed/cond.npy` | `4a13aa1133fabc9730e86b573a8c00bb5568ca87fd71e4068c41fb81a9e99b1e` |

复现命令（所有路径由开发者指向已取得的研究资源；脚本不会自动下载）：

```bash
python scripts/motion/validate-anytop-cpu.py \
  --research-only \
  --source /absolute/path/to/inspected/AnyTop \
  --checkpoint /absolute/path/to/model.pt \
  --condition /absolute/path/to/cond.npy \
  --model-args /absolute/path/to/args.json \
  --t5-dir /absolute/path/to/official/t5-base \
  --output /absolute/path/to/research-output \
  --checkpoint-sha256 daf581e4fc8e601b32940e39fb24ef8cfdbf8fd3612ef9a75d1b4c7795b99afb \
  --condition-sha256 4a13aa1133fabc9730e86b573a8c00bb5568ca87fd71e4068c41fb81a9e99b1e \
  --species Cat --frames 40 --threads 2
```

研究结果用于确认模型执行、骨架输入与生成轨迹的真实情况。即便生成成功，也不能宣称已验证朏朏的 25 关节身体、音乐条件、即时目标控制、当前姿态续接、接地修正、浏览器推理或商用适用性。接入产品之前，需要把这些缺口逐项补齐，并使用允许目标用途的模型与数据。

### 本次实测结果

已完成一次真实 checkpoint 推理。测量原始摘要保存在 `scripts/motion/anytop-cpu-research-result.json`，生成序列与研究资源留在独立实验目录，没有加入插件包。

| 项目 | 结果 |
| --- | --- |
| 身体 | 官方条件文件中的 Cat，43 个关节；不是 ECHO 的 25 关节朏朏 |
| 生成 | 100 个扩散步骤，40 帧，20 Hz，seed 10 |
| 运行设备 | 本次环境 CPU，限制 2 个推理线程 |
| T5 关节编码 | 约 0.856 秒，包含本次编码器加载 |
| 扩散采样 | 约 5.354 秒，生成约 2 秒运动；没有满足桌面即时运动延迟目标 |
| 数据 | 全部有限；平均关节逐帧位移约 0.00248 个源身体单位 |
| Padding 一致性 | 实际 43 关节与官方 143 关节 padding 的一次前向对照最大绝对差为 0 |
| 未修正骨长波动 | 变异系数中位数约 2.76%，最大约 15.94%；还需要约束与质量评估 |

上述时间只描述这一环境、这一输入的一次执行，不是泛化性能承诺。完整首包还包含其他加载与准备过程。未应用 IK 接地后处理，尚未证明可自然续接用户打断，也未将研究模型接入产品运行时。

这次验证确立的是：**无需 CUDA 也可以实际执行这一小型动物运动模型；困难转向身体适配、条件控制、连续交互、速度与可用许可。** 不能把缺少默认环境依赖误认为没有可用模型，也不能把一次成功研究采样当成已交付数字生命运动系统。

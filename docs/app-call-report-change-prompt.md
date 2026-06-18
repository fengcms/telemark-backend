# APP AI 修改提示词：通话上报备注规则

请修改员工 APP 的通话结果上报功能，对接后端接口 `POST /api/calls/report` 的新规则。

## 目标

当用户反馈类型为"已接听"时，必须填写通话备注；当用户反馈类型为其他结果时，不展示备注输入，不提交备注。

## 后端规则

- `callResult=1` 表示"已接听"，此时 `callRemark` 必填，且去掉首尾空格后不能为空。
- `callResult=2` 表示"无人接听"，不需要传 `callRemark`。
- `callResult=3` 表示"拒接"，不需要传 `callRemark`。
- `callResult=4` 表示"空号停机"，不需要传 `callRemark`。
- 非"已接听"结果即使误传 `callRemark`，后端也会忽略，并把本次通话日志备注保存为空。

## 前端交互要求

- 反馈弹窗中，只有选择"已接听"时展示备注输入框。
- 选择"已接听"时，提交按钮需要校验备注非空。
- 备注校验使用 `trim()` 后的内容，纯空格视为未填写。
- 从"已接听"切换到其他反馈类型时，清空本地备注状态。
- 选择"无人接听"、"拒接"、"空号停机"时，隐藏备注输入框，提交请求体里不要包含 `callRemark` 字段。

## 请求体示例

已接听：

```json
{
  "customerId": 1,
  "duration": 66,
  "callResult": 1,
  "callRemark": "客户已接听，有明确意向",
  "clientRequestId": "uuid-from-app",
  "startedAt": "2026-06-13T01:15:30.000Z",
  "endedAt": "2026-06-13T01:16:36.000Z"
}
```

无人接听：

```json
{
  "customerId": 1,
  "duration": 0,
  "callResult": 2,
  "clientRequestId": "uuid-from-app",
  "startedAt": "2026-06-13T01:15:30.000Z",
  "endedAt": "2026-06-13T01:15:30.000Z"
}
```

## 错误处理

如果后端返回 `400` 且消息为"参数错误：已接听时 callRemark 必填"，请在备注输入框附近提示用户补充备注，并保持反馈弹窗打开。

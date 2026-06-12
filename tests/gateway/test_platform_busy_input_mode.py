"""Per-platform busy_input_mode regression tests.

Slack users often work in multiple visible threads at once.  A global
``display.busy_input_mode: interrupt`` is still useful for CLI/DM operators, but
Slack should be able to opt into queueing follow-ups without changing every
platform or relying on process-wide env hacks.
"""

from __future__ import annotations

import sys
import types
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# Minimal Telegram stubs so gateway.run imports cleanly in focused tests.
_tg = types.ModuleType("telegram")
_tg.constants = types.ModuleType("telegram.constants")
_ct = MagicMock()
_ct.SUPERGROUP = "supergroup"
_ct.GROUP = "group"
_ct.PRIVATE = "private"
_tg.constants.ChatType = _ct
sys.modules.setdefault("telegram", _tg)
sys.modules.setdefault("telegram.constants", _tg.constants)
sys.modules.setdefault("telegram.ext", types.ModuleType("telegram.ext"))

from gateway.config import Platform  # noqa: E402
from gateway.platforms.base import MessageEvent, MessageType, SessionSource  # noqa: E402
from gateway.run import GatewayRunner  # noqa: E402


def _make_runner() -> GatewayRunner:
    runner = object.__new__(GatewayRunner)
    runner._running_agents = {}
    runner._running_agents_ts = {}
    runner._pending_messages = {}
    runner._busy_ack_ts = {}
    runner._draining = False
    runner._busy_input_mode = "interrupt"
    runner._busy_text_mode = "interrupt"
    runner.adapters = {}
    runner.config = MagicMock()
    runner.session_store = None
    runner.hooks = MagicMock()
    runner.hooks.emit = AsyncMock()
    runner.pairing_store = MagicMock()
    runner.pairing_store.is_approved.return_value = True
    runner._is_user_authorized = lambda _source: True
    return runner


def _make_adapter() -> MagicMock:
    adapter = MagicMock()
    adapter._pending_messages = {}
    adapter._send_with_retry = AsyncMock()
    adapter.config = MagicMock()
    adapter.config.extra = {}
    adapter.platform = Platform.SLACK
    return adapter


def _make_slack_event(text: str = "follow up") -> MessageEvent:
    return MessageEvent(
        text=text,
        message_type=MessageType.TEXT,
        source=SessionSource(
            platform=Platform.SLACK,
            chat_id="C1",
            chat_type="group",
            user_id="U1",
            thread_id="1000.0001",
        ),
        message_id="1000.0002",
    )


def test_platform_config_busy_input_mode_overrides_global_interrupt(monkeypatch) -> None:
    runner = _make_runner()
    monkeypatch.delenv("HERMES_GATEWAY_BUSY_INPUT_MODE_SLACK", raising=False)

    with patch(
        "gateway.run._load_gateway_config",
        return_value={
            "display": {
                "busy_input_mode": "interrupt",
                "platforms": {"slack": {"busy_input_mode": "queue"}},
            }
        },
    ):
        assert runner._resolve_busy_input_mode_for_source(_make_slack_event().source) == "queue"


def test_platform_env_busy_input_mode_overrides_config(monkeypatch) -> None:
    runner = _make_runner()
    monkeypatch.setenv("HERMES_GATEWAY_BUSY_INPUT_MODE_SLACK", "steer")

    with patch(
        "gateway.run._load_gateway_config",
        return_value={
            "display": {
                "busy_input_mode": "interrupt",
                "platforms": {"slack": {"busy_input_mode": "queue"}},
            }
        },
    ):
        assert runner._resolve_busy_input_mode_for_source(_make_slack_event().source) == "steer"


@pytest.mark.asyncio
async def test_slack_platform_queue_mode_does_not_interrupt_running_agent(monkeypatch) -> None:
    runner = _make_runner()
    adapter = _make_adapter()
    event = _make_slack_event("please queue this")
    session_key = "agent:main:slack:group:C1:1000.0001"
    parent = MagicMock()
    parent.get_activity_summary.return_value = {
        "api_call_count": 3,
        "max_iterations": 60,
        "current_tool": "terminal",
    }
    runner._running_agents[session_key] = parent
    runner.adapters[Platform.SLACK] = adapter
    monkeypatch.delenv("HERMES_GATEWAY_BUSY_INPUT_MODE_SLACK", raising=False)

    with patch(
        "gateway.run._load_gateway_config",
        return_value={
            "display": {
                "busy_input_mode": "interrupt",
                "platforms": {"slack": {"busy_input_mode": "queue"}},
            }
        },
    ), patch("gateway.run.merge_pending_message_event") as merge_mock:
        handled = await runner._handle_active_session_busy_message(event, session_key)

    assert handled is True
    parent.interrupt.assert_not_called()
    merge_mock.assert_called_once()
    adapter._send_with_retry.assert_called_once()
    sent = adapter._send_with_retry.call_args.kwargs["content"]
    assert "Queued for the next turn" in sent
    assert "Interrupting current task" not in sent

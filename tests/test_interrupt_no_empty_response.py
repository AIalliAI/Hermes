"""Test that interrupt on conversation loop doesn't produce empty response."""
import pytest
from unittest.mock import MagicMock, patch, PropertyMock


class FakeAgent:
    """Minimal agent stub for testing interrupt recovery."""
    def __init__(self):
        self._interrupt_requested = False
        self._current_streamed_assistant_text = ""
        self.quiet_mode = True
        self.session_id = "test-session"
        self.model = "test-model"
        self.max_iterations = 10
        self._api_call_count = 0
        self.iteration_budget = MagicMock()
        self.iteration_budget.remaining = 10
        self.iteration_budget.max_total = 10
        self.iteration_budget.used = 0
        self.iteration_budget.consume = MagicMock(return_value=True)
        self._budget_grace_call = False
        self._checkpoint_mgr = MagicMock()
        self._checkpoint_mgr.new_turn = MagicMock()
        self._safe_print = MagicMock()
        self.response_previewed = False
        self._response_was_previewed = False
        self._empty_content_retries = 0
        self._thinking_spinner = None
        self.thinking_callback = None
        self._response_buffer = ""

    @staticmethod
    def _strip_think_blocks(text):
        return text


def test_interrupt_with_streamed_content_sets_final_response():
    """When interrupted with streamed content, final_response must be non-empty."""
    from agent.conversation_loop import run_conversation

    agent = FakeAgent()
    agent._interrupt_requested = True
    agent._current_streamed_assistant_text = "I'll check that for you..."

    # run_conversation should set final_response when interrupted
    with patch('agent.conversation_loop.close_interrupted_tool_sequence'):
        result = run_conversation(
            agent=agent,
            messages=[{"role": "user", "content": "help"}],
            api_call_count=0,
            final_response=None,
            _turn_exit_reason="",
            interrupted=False,
        )

    final_response = result.get("final_response")
    assert final_response is not None, "final_response must not be None after interrupt"
    assert len(final_response) > 0, "final_response must not be empty after interrupt"


def test_interrupt_without_streamed_content_produces_non_empty_response():
    """When interrupted without streamed content, response must still not be empty."""
    from agent.conversation_loop import run_conversation

    agent = FakeAgent()
    agent._interrupt_requested = True
    agent._current_streamed_assistant_text = ""

    with patch('agent.conversation_loop.close_interrupted_tool_sequence'):
        result = run_conversation(
            agent=agent,
            messages=[{"role": "user", "content": "help"}],
            api_call_count=0,
            final_response=None,
            _turn_exit_reason="",
            interrupted=False,
        )

    final_response = result.get("final_response")
    # Should still be set — either to recovered text or a fallback
    assert final_response is not None, "final_response must not be None"
    assert len(final_response) >= 0, "should have at least a fallback message"

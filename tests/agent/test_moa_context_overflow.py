"""Tests for MoA context overflow handling (issue #60345).

These are negative-control tests: they must FAIL on clean origin/main
(where context overflow is silent) and PASS with the fix.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import pytest


class TestMoAContextOverflow:
    """Verify that _run_reference trims messages when context overflow would occur."""

    @pytest.fixture()
    def moa_module(self):
        """Import and return the moa_loop module."""
        import agent.moa_loop as moa
        return moa

    def test_context_overflow_triggers_trimming(self, moa_module):
        """When estimated tokens > context length, messages should be trimmed."""
        from agent.model_metadata import estimate_messages_tokens_rough

        # Create messages that will definitely exceed a small context
        long_message = "x" * 100000  # ~25K tokens
        messages = [
            {"role": "system", "content": "You are a helpful assistant."},
            {"role": "user", "content": long_message},
            {"role": "assistant", "content": "I understand."},
            {"role": "user", "content": long_message},
        ]

        # Mock get_model_context_length to return a small context
        with patch("agent.moa_loop.get_model_context_length", return_value=1000):
            with patch("agent.moa_loop.call_llm") as mock_call_llm:
                # Set up mock response
                mock_response = MagicMock()
                mock_response.usage = None
                mock_call_llm.return_value = mock_response

                slot = {"provider": "test", "model": "test-model"}
                ref_messages = messages[1:]  # Exclude system prompt

                # Call _run_reference
                label, text, acct = moa_module._run_reference(
                    slot, ref_messages, temperature=0.7
                )

                # Verify that call_llm was called with trimmed messages
                assert mock_call_llm.called
                call_args = mock_call_llm.call_args
                actual_messages = call_args.kwargs.get("messages") or call_args[1]

                # The messages should have been trimmed
                estimated_tokens = estimate_messages_tokens_rough(actual_messages)
                assert estimated_tokens <= 1000, (
                    f"Messages should be trimmed to fit within 1000 tokens, "
                    f"but estimated {estimated_tokens} tokens"
                )

    def test_context_within_limit_no_trimming(self, moa_module):
        """When estimated tokens <= context length, messages should NOT be trimmed."""
        with patch("agent.moa_loop.get_model_context_length", return_value=1000000):
            with patch("agent.moa_loop.call_llm") as mock_call_llm:
                mock_response = MagicMock()
                mock_response.usage = None
                mock_call_llm.return_value = mock_response

                messages = [
                    {"role": "user", "content": "Short message."},
                ]

                slot = {"provider": "test", "model": "test-model"}

                label, text, acct = moa_module._run_reference(
                    slot, messages, temperature=0.7
                )

                # Verify that call_llm was called with original messages
                assert mock_call_llm.called
                call_args = mock_call_llm.call_args
                actual_messages = call_args.kwargs.get("messages") or call_args[1]

                # Should have system prompt + original messages
                assert len(actual_messages) == 2  # system + 1 user message

    def test_trim_messages_to_context(self, moa_module):
        """Test the _trim_messages_to_context helper function directly."""
        from agent.model_metadata import estimate_messages_tokens_rough

        # Create a long conversation
        messages = [
            {"role": "system", "content": "System prompt."},
            {"role": "user", "content": "Message 1"},
            {"role": "assistant", "content": "Response 1"},
            {"role": "user", "content": "Message 2"},
            {"role": "assistant", "content": "Response 2"},
            {"role": "user", "content": "Message 3"},
            {"role": "assistant", "content": "Response 3"},
            {"role": "user", "content": "Message 4"},
            {"role": "assistant", "content": "Response 4"},
            {"role": "user", "content": "Message 5"},
        ]

        # Mock estimate_messages_tokens_rough to return decreasing values
        def mock_estimate(messages):
            # Return a value that ensures we need to trim
            base = 1000
            return base + len(messages) * 500

        with patch(
            "agent.moa_loop.estimate_messages_tokens_rough",
            side_effect=mock_estimate,
        ):
            trimmed = moa_module._trim_messages_to_context(messages, context_length=1500)

            # Should preserve system prompt and some recent messages
            assert trimmed[0]["role"] == "system"
            assert len(trimmed) < len(messages)
            # Most recent messages should be preserved
            assert trimmed[-1]["content"] == "Message 5"

    def test_exception_emits_event(self, moa_module):
        """When call_llm raises an exception, the on_failure callback should be called."""
        with patch("agent.moa_loop.get_model_context_length", return_value=1000000):
            with patch("agent.moa_loop.call_llm") as mock_call_llm:
                mock_call_llm.side_effect = Exception("HTTP 400: context length exceeded")

                slot = {"provider": "test", "model": "test-model"}
                messages = [{"role": "user", "content": "Test"}]

                failure_callback_called = False
                failure_label = None
                failure_exception = None

                def on_failure(label, exc):
                    nonlocal failure_callback_called, failure_label, failure_exception
                    failure_callback_called = True
                    failure_label = label
                    failure_exception = exc

                label, text, acct = moa_module._run_reference(
                    slot, messages, temperature=0.7, on_failure=on_failure
                )

                assert failure_callback_called
                assert failure_label == "test:test-model"
                assert "HTTP 400" in str(failure_exception)
                assert "failed" in text


class TestNegativeControl:
    """Negative-control tests that should FAIL on main and PASS with fix."""

    def test_main_branch_should_fail_context_check(self, moa_module):
        """On main, _run_reference does NOT check context length before calling call_llm.

        This test documents the bug: on main, a context overflow error would be
        caught silently. With the fix, the context is checked and messages are
        trimmed before calling call_llm.
        """
        import inspect

        source = inspect.getsource(moa_module._run_reference)

        # Check that the fix is in place
        has_context_check = "get_model_context_length" in source
        has_trimming = "_trim_messages_to_context" in source

        assert has_context_check, (
            "Fix not applied: _run_reference should call get_model_context_length"
        )
        assert has_trimming, (
            "Fix not applied: _run_reference should call _trim_messages_to_context"
        )

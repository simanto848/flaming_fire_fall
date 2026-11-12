#!/usr/bin/env python3
"""
ShunnoShikha AI - Super-Intelligence LLM Brain
OpenAI-compatible multimodal client with an autonomous ReAct tool-calling loop.

Default backend: local Ollama `lfm3-omni` (capabilities: completion, vision, tools, audio, speech).
Any OpenAI-compatible provider works via environment configuration:
  SHUNNO_LLM_BASE_URL   (default http://localhost:11434/v1)
  SHUNNO_LLM_MODEL      (default lfm3-omni:latest)
  SHUNNO_LLM_API_KEY    (default "ollama"; set for cloud providers)
  SHUNNO_VISION_MODEL   (optional fallback vision model, e.g. qwen2.5vl:3b)
"""

import os
import json
import base64
import logging
from typing import Dict, List, Any, Optional, Callable

import httpx

logger = logging.getLogger("shunnoshikha.llm")

DEFAULT_BASE_URL = os.environ.get("SHUNNO_LLM_BASE_URL", "http://localhost:11434/v1")
DEFAULT_MODEL = os.environ.get("SHUNNO_LLM_MODEL", "lfm3-omni:latest")
DEFAULT_API_KEY = os.environ.get("SHUNNO_LLM_API_KEY", "ollama")
VISION_MODEL = os.environ.get("SHUNNO_VISION_MODEL", "")


def build_user_content(
    text: str,
    image_b64: Optional[str] = None,
    audio_b64: Optional[str] = None,
    audio_format: str = "wav",
) -> Any:
    """Builds an OpenAI multimodal content payload (text + image + audio)."""
    if not image_b64 and not audio_b64:
        return text
    parts: List[Dict[str, Any]] = [{"type": "text", "text": text}]
    if image_b64:
        url = image_b64 if image_b64.startswith("data:") else f"data:image/png;base64,{image_b64}"
        parts.append({"type": "image_url", "image_url": {"url": url}})
    if audio_b64:
        parts.append({
            "type": "input_audio",
            "input_audio": {"data": audio_b64.split(",")[-1], "format": audio_format},
        })
    return parts


class LLMBrain:
    """Multimodal LLM client with native tool-calling loop and graceful degradation."""

    def __init__(
        self,
        base_url: str = DEFAULT_BASE_URL,
        model: str = DEFAULT_MODEL,
        api_key: str = DEFAULT_API_KEY,
        timeout: float = 240.0,
    ):
        self.base_url = base_url.rstrip("/")
        self.model = model
        self.api_key = api_key
        self.timeout = timeout
        self._available: Optional[bool] = None

    # ---------------- availability ----------------
    def is_available(self) -> bool:
        try:
            with httpx.Client(timeout=4.0, trust_env=False) as client:
                r = client.get(
                    f"{self.base_url}/models",
                    headers={"Authorization": f"Bearer {self.api_key}"},
                )
                self._available = r.status_code == 200
        except Exception:
            self._available = False
        return self._available

    def status(self) -> Dict[str, Any]:
        available = self.is_available()
        return {
            "available": available,
            "base_url": self.base_url,
            "model": self.model,
            "capabilities": ["text-generation", "tool-calling", "vision", "audio-understanding"] if available else [],
            "mode": "LLM_SUPER_INTELLIGENCE" if available else "DETERMINISTIC_PHYSICS_FALLBACK",
        }

    # ---------------- core completion ----------------
    def chat(
        self,
        messages: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None,
        max_tokens: int = 1400,
        temperature: float = 0.3,
        model: Optional[str] = None,
    ) -> Dict[str, Any]:
        payload: Dict[str, Any] = {
            "model": model or self.model,
            "messages": messages,
            "max_tokens": max_tokens,
            "temperature": temperature,
        }
        if tools:
            payload["tools"] = tools
            payload["tool_choice"] = "auto"
        with httpx.Client(timeout=self.timeout, trust_env=False) as client:
            r = client.post(
                f"{self.base_url}/chat/completions",
                json=payload,
                headers={"Authorization": f"Bearer {self.api_key}"},
            )
            r.raise_for_status()
            data = r.json()
        return data["choices"][0]["message"]

    # ---------------- autonomous tool loop ----------------
    def run_tool_loop(
        self,
        system_prompt: str,
        user_content: Any,
        tool_schemas: List[Dict[str, Any]],
        tool_executor: Callable[[str, Dict[str, Any]], Dict[str, Any]],
        max_steps: int = 6,
        max_tokens: int = 1400,
        history: Optional[List[Dict[str, Any]]] = None,
    ) -> Dict[str, Any]:
        """
        ReAct-style autonomous loop:
        model reasons -> emits tool_calls -> executor runs real module tools ->
        results fed back -> model synthesizes final grounded answer.
        """
        messages: List[Dict[str, Any]] = [{"role": "system", "content": system_prompt}]
        if history:
            messages.extend(history)
        messages.append({"role": "user", "content": user_content})

        trace: List[Dict[str, Any]] = []
        final_text = ""
        steps = 0

        while steps < max_steps:
            steps += 1
            try:
                msg = self.chat(messages, tools=tool_schemas, max_tokens=max_tokens)
            except httpx.HTTPStatusError as e:
                # Model may reject native tools; retry once without tool schema
                if e.response.status_code == 400 and "tools" in e.response.text:
                    msg = self.chat(messages, tools=None, max_tokens=max_tokens)
                    final_text = msg.get("content") or ""
                    break
                raise

            tool_calls = msg.get("tool_calls") or []
            if not tool_calls:
                final_text = msg.get("content") or ""
                break

            messages.append({
                "role": "assistant",
                "content": msg.get("content") or "",
                "tool_calls": tool_calls,
            })
            for tc in tool_calls:
                fn = tc.get("function", {})
                name = fn.get("name", "")
                try:
                    args = json.loads(fn.get("arguments") or "{}")
                except json.JSONDecodeError:
                    args = {}
                try:
                    result = tool_executor(name, args)
                except Exception as exc:
                    result = {"error": f"Tool execution failed: {exc}"}
                result_str = json.dumps(result, default=str)
                if len(result_str) > 6000:
                    result_str = result_str[:6000] + "... [truncated]"
                trace.append({"tool": name, "arguments": args, "result_preview": result_str[:900]})
                messages.append({
                    "role": "tool",
                    "tool_call_id": tc.get("id", f"call_{steps}"),
                    "content": result_str,
                })
        else:
            # Step budget exhausted: force a synthesis pass without tools
            messages.append({
                "role": "user",
                "content": "Tool budget reached. Synthesize your final answer now from the evidence gathered above. Cite sources.",
            })
            msg = self.chat(messages, tools=None, max_tokens=max_tokens)
            final_text = msg.get("content") or ""

        return {"text": final_text, "tool_trace": trace, "steps": steps}

    # ---------------- voice ----------------
    def transcribe_audio(self, audio_b64: str, audio_format: str = "wav") -> str:
        """Uses the omni model's audio understanding to transcribe speech."""
        msg = self.chat(
            [{"role": "user", "content": build_user_content(
                "Transcribe this audio verbatim. Output only the transcription, nothing else.",
                audio_b64=audio_b64, audio_format=audio_format,
            )}],
            max_tokens=400, temperature=0.0,
        )
        return (msg.get("content") or "").strip()

    def describe_image(self, image_b64: str, prompt: str = "Describe this image in detail.") -> str:
        model = VISION_MODEL or self.model
        msg = self.chat(
            [{"role": "user", "content": build_user_content(prompt, image_b64=image_b64)}],
            max_tokens=700, model=model,
        )
        return (msg.get("content") or "").strip()
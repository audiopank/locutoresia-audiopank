
"""Base Classes for AI Agent Army."""

from abc import ABC, abstractmethod
from typing import Dict, Any, Optional
import json


class AgentMessage:
    """Represents a message passed between agents."""
    
    def __init__(self, sender: str, content: Dict[str, Any], message_type: str = "data"):
        self.sender = sender
        self.content = content
        self.message_type = message_type
    
    def to_dict(self):
        return {
            "sender": self.sender,
            "content": self.content,
            "message_type": self.message_type
        }
    
    @classmethod
    def from_dict(cls, data: Dict[str, Any]):
        return cls(
            sender=data["sender"],
            content=data["content"],
            message_type=data.get("message_type", "data")
        )


class BaseAgent(ABC):
    """Abstract base class for all agents."""
    
    def __init__(self, name: str, orchestrator=None):
        self.name = name
        self.orchestrator = orchestrator
        self.state = {}
    
    def send_message(self, recipient: str, content: Dict[str, Any], message_type: str = "data"):
        """Send a message to another agent via the orchestrator."""
        if self.orchestrator:
            msg = AgentMessage(self.name, content, message_type)
            self.orchestrator.route_message(msg, recipient)
    
    @abstractmethod
    def process_message(self, message: AgentMessage):
        """Process an incoming message and optionally return a response."""
        pass
    
    @abstractmethod
    def execute(self, context: Dict[str, Any]):
        """Execute the agent's primary task with the given context."""
        pass

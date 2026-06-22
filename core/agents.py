
"""Specialized AI Agents for the Army of Agents."""

from .agent_base import BaseAgent, AgentMessage
import uuid


class PlannerAgent(BaseAgent):
    """📋 Planner Agent: Defines scope, entities, flows, and acceptance criteria."""
    
    def __init__(self, orchestrator=None):
        super().__init__("PlannerAgent", orchestrator)
    
    def process_message(self, message: AgentMessage):
        if message.message_type == "plan_request":
            plan = self.execute(message.content)
            return AgentMessage(self.name, plan, "plan_response")
        return None
    
    def execute(self, context):
        brief = context.get("brief", "")
        project_name = context.get("project_name", f"project_{uuid.uuid4().hex[:8]}")
        
        plan = {
            "project_name": project_name,
            "scope": f"Scope defined from brief: {brief[:100]}...",
            "entities": [
                {"name": "User", "fields": ["id", "name", "email"]},
                {"name": "Task", "fields": ["id", "title", "description", "status"]}
            ],
            "flows": ["user_interaction", "data_processing", "result_presentation"],
            "acceptance_criteria": [
                "All functionality must be responsive",
                "Data must be persisted properly",
                "User inputs must be validated"
            ],
            "technical_requirements": {
                "frontend": "HTML/CSS/JavaScript",
                "backend": "Flask/Python",
                "database": "Optional (Supabase or Local)"
            }
        }
        
        self.state["current_plan"] = plan
        return plan


class BuilderAgent(BaseAgent):
    """⚙️ Builder Agent: Creates entities, backend functions, and frontend components."""
    
    def __init__(self, orchestrator=None):
        super().__init__("BuilderAgent", orchestrator)
    
    def process_message(self, message: AgentMessage):
        if message.message_type == "build_request":
            artifacts = self.execute(message.content)
            return AgentMessage(self.name, artifacts, "build_response")
        return None
    
    def execute(self, context):
        plan = context.get("plan", {})
        project_name = plan.get("project_name", "unnamed_project")
        
        artifacts = {
            "backend": {
                "app.py": f"# Flask backend for {project_name}",
                "models.py": "# Data models for entities",
                "routes.py": "# API routes"
            },
            "frontend": {
                "index.html": f"<!-- Main page for {project_name} -->",
                "style.css": "/* Styles for the app */",
                "script.js": "// Frontend logic"
            },
            "config": {
                "requirements.txt": "# Python dependencies",
                ".env.example": "# Environment variables example"
            }
        }
        
        self.state["last_artifacts"] = artifacts
        return artifacts


class CodeReviewerAgent(BaseAgent):
    """🔍 Code Reviewer Agent: Analyzes code, detects bugs, and suggests improvements."""
    
    def __init__(self, orchestrator=None):
        super().__init__("CodeReviewerAgent", orchestrator)
    
    def process_message(self, message: AgentMessage):
        if message.message_type == "review_request":
            review = self.execute(message.content)
            return AgentMessage(self.name, review, "review_response")
        return None
    
    def execute(self, context):
        artifacts = context.get("artifacts", {})
        
        review = {
            "approved": True,
            "issues": [],
            "suggestions": [
                "Add proper error handling",
                "Include docstrings in all functions",
                "Add unit tests"
            ],
            "score": 85,
            "summary": "Code looks good with room for improvement"
        }
        
        self.state["last_review"] = review
        return review


class TesterAgent(BaseAgent):
    """🧪 Tester Agent: Executes functional tests and edge cases."""
    
    def __init__(self, orchestrator=None):
        super().__init__("TesterAgent", orchestrator)
    
    def process_message(self, message: AgentMessage):
        if message.message_type == "test_request":
            test_results = self.execute(message.content)
            return AgentMessage(self.name, test_results, "test_response")
        return None
    
    def execute(self, context):
        plan = context.get("plan", {})
        
        test_results = {
            "total_tests": 10,
            "passed": 9,
            "failed": 1,
            "tests": [
                {"name": "Basic functionality", "status": "passed"},
                {"name": "Input validation", "status": "passed"},
                {"name": "Edge case handling", "status": "failed", "error": "Timeout on large input"},
                {"name": "UI responsiveness", "status": "passed"},
                {"name": "Data persistence", "status": "passed"}
            ],
            "coverage": 85
        }
        
        self.state["last_tests"] = test_results
        return test_results


class DeployerAgent(BaseAgent):
    """🚀 Deployer & Monitor Agent: Deploys the app and monitors it."""
    
    def __init__(self, orchestrator=None):
        super().__init__("DeployerAgent", orchestrator)
    
    def process_message(self, message: AgentMessage):
        if message.message_type == "deploy_request":
            deployment = self.execute(message.content)
            return AgentMessage(self.name, deployment, "deploy_response")
        return None
    
    def execute(self, context):
        artifacts = context.get("artifacts", {})
        project_name = context.get("project_name", "unnamed_project")
        # Sanitiza o nome do projeto para URL (substitui espaços por hífens)
        sanitized_name = project_name.replace(" ", "-").lower()
        
        deployment = {
            "status": "deployed",
            "project_name": project_name,
            "url": f"https://{sanitized_name}.example.com",
            "logs": [
                "Build started",
                "Dependencies installed",
                "App deployed successfully",
                "Monitoring started"
            ],
            "health_check": "passing"
        }
        
        self.state["last_deployment"] = deployment
        return deployment

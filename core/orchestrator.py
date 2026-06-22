
"""🧠 Orchestrator Agent: Master Agent that coordinates all other agents."""

from .agent_base import BaseAgent, AgentMessage
from .agents import (
    PlannerAgent,
    BuilderAgent,
    CodeReviewerAgent,
    TesterAgent,
    DeployerAgent
)
import uuid
import threading
import time


class OrchestratorAgent(BaseAgent):
    """Master Agent that coordinates the entire pipeline."""
    
    def __init__(self):
        super().__init__("OrchestratorAgent", None)
        self.agents = {}
        self.pipelines = {}
        self._init_agents()
    
    def _init_agents(self):
        """Initialize all specialized agents."""
        self.agents["PlannerAgent"] = PlannerAgent(self)
        self.agents["BuilderAgent"] = BuilderAgent(self)
        self.agents["CodeReviewerAgent"] = CodeReviewerAgent(self)
        self.agents["TesterAgent"] = TesterAgent(self)
        self.agents["DeployerAgent"] = DeployerAgent(self)
    
    def route_message(self, message: AgentMessage, recipient: str):
        """Route a message to a specific agent."""
        if recipient in self.agents:
            self.agents[recipient].process_message(message)
    
    def process_message(self, message: AgentMessage):
        return None
    
    def execute(self, context):
        """Execute the full pipeline: Plan → Build → Review → Test → Deploy."""
        brief = context.get("brief", "")
        project_name = context.get("project_name", f"project_{uuid.uuid4().hex[:8]}")
        pipeline_id = str(uuid.uuid4())
        
        pipeline = {
            "id": pipeline_id,
            "project_name": project_name,
            "status": "running",
            "steps": [],
            "current_step": 0,
            "artifacts": {},
            "started_at": time.time(),
            "finished_at": None,
            "errors": []
        }
        self.pipelines[pipeline_id] = pipeline
        
        try:
            # Step 1: Plan
            pipeline["steps"].append({
                "name": "Planning",
                "status": "in_progress"
            })
            plan = self.agents["PlannerAgent"].execute({
                "brief": brief,
                "project_name": project_name
            })
            pipeline["artifacts"]["plan"] = plan
            pipeline["steps"][-1]["status"] = "completed"
            pipeline["steps"][-1]["result"] = plan
            
            # Step 2: Build
            pipeline["steps"].append({
                "name": "Building",
                "status": "in_progress"
            })
            artifacts = self.agents["BuilderAgent"].execute({
                "plan": plan
            })
            pipeline["artifacts"]["build"] = artifacts
            pipeline["steps"][-1]["status"] = "completed"
            pipeline["steps"][-1]["result"] = artifacts
            
            # Step 3: Review
            pipeline["steps"].append({
                "name": "Code Review",
                "status": "in_progress"
            })
            review = self.agents["CodeReviewerAgent"].execute({
                "artifacts": artifacts
            })
            pipeline["artifacts"]["review"] = review
            pipeline["steps"][-1]["status"] = "completed"
            pipeline["steps"][-1]["result"] = review
            
            # If not approved, loop back to Builder
            max_loops = 3
            loop_count = 0
            while not review["approved"] and loop_count < max_loops:
                loop_count += 1
                pipeline["steps"].append({
                    "name": f"Rebuild (Loop {loop_count})",
                    "status": "in_progress"
                })
                # Simulate fixing issues
                artifacts = self.agents["BuilderAgent"].execute({
                    "plan": plan,
                    "review": review
                })
                pipeline["artifacts"]["build"] = artifacts
                
                pipeline["steps"].append({
                    "name": f"Re-review (Loop {loop_count})",
                    "status": "in_progress"
                })
                review = self.agents["CodeReviewerAgent"].execute({
                    "artifacts": artifacts
                })
                pipeline["artifacts"]["review"] = review
                pipeline["steps"][-2]["status"] = "completed"
                pipeline["steps"][-1]["status"] = "completed"
                pipeline["steps"][-2]["result"] = artifacts
                pipeline["steps"][-1]["result"] = review
            
            # Step 4: Test
            pipeline["steps"].append({
                "name": "Testing",
                "status": "in_progress"
            })
            test_results = self.agents["TesterAgent"].execute({
                "plan": plan,
                "artifacts": artifacts
            })
            pipeline["artifacts"]["tests"] = test_results
            pipeline["steps"][-1]["status"] = "completed"
            pipeline["steps"][-1]["result"] = test_results
            
            # Step 5: Deploy
            pipeline["steps"].append({
                "name": "Deployment",
                "status": "in_progress"
            })
            deployment = self.agents["DeployerAgent"].execute({
                "artifacts": artifacts,
                "project_name": project_name
            })
            pipeline["artifacts"]["deployment"] = deployment
            pipeline["steps"][-1]["status"] = "completed"
            pipeline["steps"][-1]["result"] = deployment
            
            pipeline["status"] = "completed"
            
        except Exception as e:
            pipeline["status"] = "failed"
            pipeline["errors"].append(str(e))
        
        pipeline["finished_at"] = time.time()
        pipeline["duration"] = pipeline["finished_at"] - pipeline["started_at"]
        return pipeline
    
    def get_pipeline(self, pipeline_id: str):
        """Get a pipeline by its ID."""
        return self.pipelines.get(pipeline_id)
    
    def list_pipelines(self):
        """List all pipelines."""
        return list(self.pipelines.values())


# Global orchestrator instance
_orchestrator_instance = None
_orchestrator_lock = threading.Lock()


def get_orchestrator():
    """Get the global orchestrator instance (singleton)."""
    global _orchestrator_instance
    if _orchestrator_instance is None:
        with _orchestrator_lock:
            if _orchestrator_instance is None:
                _orchestrator_instance = OrchestratorAgent()
    return _orchestrator_instance

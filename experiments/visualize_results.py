import matplotlib.pyplot as plt
import networkx as nx
import numpy as np

from risk_qemcmc.problems.finance import financial_instance

def visualize_network(n=12, seed=42):
    # Generate the EGJ network data
    J, h, A, tiers = financial_instance(n, seed=seed)
    
    # Create directed graph from dependency matrix A
    G = nx.DiGraph(A)
    
    # Color mapping based on tiers
    colors = []
    sizes = []
    labels = {}
    for i, t in enumerate(tiers):
        labels[i] = str(i)
        if t == "core":
            colors.append("red")
            sizes.append(800)
        elif t == "intermediate":
            colors.append("orange")
            sizes.append(500)
        else:  # periphery
            colors.append("green")
            sizes.append(300)
            
    plt.figure(figsize=(8, 6))
    
    # Use spring layout but with higher weight on stronger dependencies
    pos = nx.spring_layout(G, seed=42, weight='weight')
    
    # Draw edges with opacity based on dependency strength
    edges = G.edges(data=True)
    alphas = [d['weight']*2 for u, v, d in edges]
    alphas = [min(1.0, max(0.1, a)) for a in alphas]
    
    nx.draw_networkx_nodes(G, pos, node_color=colors, node_size=sizes, edgecolors='black')
    for (u, v, d), alpha in zip(edges, alphas):
        nx.draw_networkx_edges(G, pos, edgelist=[(u,v)], alpha=alpha, arrows=True, node_size=sizes)
        
    nx.draw_networkx_labels(G, pos, labels, font_size=10, font_color='white')
    
    plt.title("Financial Contagion Network Topology\nCore (Red), Intermediate (Orange), Periphery (Green)")
    plt.axis("off")
    plt.tight_layout()
    plt.savefig("network_topology.png", dpi=150)
    print("Saved network topology to network_topology.png")
    plt.close()

def plot_bar_chart(data_dict, title, ylabel, filename):
    plt.figure(figsize=(7, 5))
    names = list(data_dict.keys())
    values = list(data_dict.values())
    
    # Choose nice colors: Quantum (Purple), Classical/Metropolis (Blue), Heuristics (Grey)
    colors = []
    for name in names:
        if 'Quantum' in name:
            colors.append('#9b59b6')  # Purple
        elif 'Metropolis' in name or 'Classical' in name:
            colors.append('#3498db')  # Blue
        elif 'Exact' in name:
            colors.append('#2ecc71')  # Green
        else:
            colors.append('#95a5a6')  # Grey
            
    bars = plt.bar(names, values, color=colors)
    
    plt.title(title)
    plt.ylabel(ylabel)
    plt.grid(axis='y', linestyle='--', alpha=0.7)
    
    # Add value labels on top of bars
    for bar in bars:
        yval = bar.get_height()
        plt.text(bar.get_x() + bar.get_width()/2.0, yval, f'{yval:.3f}', va='bottom', ha='center')
        
    plt.tight_layout()
    plt.savefig(filename, dpi=150)
    print(f"Saved {filename}")
    plt.close()

def visualize_results():
    # Data from our previous experiment run
    relative_errors = {
        "Metropolis (Classical)": 0.889,
        "QeMCMC (Quantum)": 0.149
    }
    
    # Bailout Regret for K=1 (Lower is better)
    bailout_regret = {
        "Exact Optimum": 0.000,
        "Quantum-chi": 0.000,
        "Strength (Heur)": 0.022,
        "Random": 0.096,
        "Metropolis-chi": 0.151,
        "DebtRank (Heur)": 0.151
    }
    
    plot_bar_chart(
        relative_errors, 
        "Susceptibility Matrix Relative Error (Lower is Better)", 
        "Relative Error (Frobenius Norm)", 
        "relative_error.png"
    )
    
    plot_bar_chart(
        bailout_regret, 
        "Bailout Selection Regret at K=1 (Lower is Better)", 
        "Regret vs Exact Optimum", 
        "bailout_regret.png"
    )

if __name__ == "__main__":
    visualize_network()
    visualize_results()

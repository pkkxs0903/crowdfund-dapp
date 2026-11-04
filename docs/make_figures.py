import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import FancyBboxPatch, FancyArrowPatch, Rectangle

plt.rcParams["font.family"] = "serif"
plt.rcParams["font.serif"] = ["Times New Roman", "DejaVu Serif"]
DARK = "#1a1a1a"
MID = "#555555"
LIGHT = "#f4f4f4"
LINE = "#8a8a8a"


def box(ax, x, y, w, h, text, sub=None, fs=9, fill="#ffffff", bold=False, r=0.02):
    ax.add_patch(FancyBboxPatch((x, y), w, h, boxstyle=f"round,pad=0,rounding_size={r}",
                                linewidth=0.9, edgecolor=LINE, facecolor=fill, zorder=2))
    if sub:
        ax.text(x + w / 2, y + h * 0.60, text, ha="center", va="center", fontsize=fs,
                color=DARK, zorder=3, fontweight="bold" if bold else "normal")
        ax.text(x + w / 2, y + h * 0.27, sub, ha="center", va="center", fontsize=fs - 1.3,
                color=MID, zorder=3)
    else:
        ax.text(x + w / 2, y + h / 2, text, ha="center", va="center", fontsize=fs,
                color=DARK, zorder=3, fontweight="bold" if bold else "normal")


def arrow(ax, p1, p2, label=None, style="-|>", ls="-", rad=0.0, fs=7.5, lx=0, ly=0):
    ax.add_patch(FancyArrowPatch(p1, p2, arrowstyle=style, mutation_scale=9,
                                 linewidth=0.9, color=LINE, linestyle=ls,
                                 connectionstyle=f"arc3,rad={rad}", zorder=1,
                                 shrinkA=1, shrinkB=1))
    if label:
        ax.text((p1[0] + p2[0]) / 2 + lx, (p1[1] + p2[1]) / 2 + ly, label,
                ha="center", va="center", fontsize=fs, color=MID, zorder=4,
                bbox=dict(boxstyle="square,pad=0.15", fc="white", ec="none"))


def fig1():
    fig, ax = plt.subplots(figsize=(6.5, 4.3))
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 6.6)
    ax.axis("off")

    ax.text(0.15, 6.35, "Off-chain", fontsize=8.5, color=MID, style="italic")
    box(ax, 0.15, 5.25, 2.9, 0.95, "Browser UI", "React · ethers.js v6 · read-only calls")
    box(ax, 3.35, 5.25, 2.5, 0.95, "MetaMask", "key custody · tx signing")
    box(ax, 6.15, 5.25, 3.7, 0.95, "Project metadata", "title · description · images (off-chain)")

    arrow(ax, (1.6, 5.25), (1.6, 4.45), "read state", ls=(0, (3, 2)))
    arrow(ax, (4.6, 5.25), (4.6, 4.45), "signed tx", ls=(0, (3, 2)))

    box(ax, 0.15, 2.55, 9.7, 1.9, "", fill=LIGHT)
    ax.text(0.45, 4.22, "On-chain  ·  CrowdfundingPlatform.sol  (immutable, Sepolia)",
            fontsize=8.5, color=DARK, fontweight="bold")
    box(ax, 0.45, 3.35, 2.9, 0.7, "State", "projects · investments · pool", fs=8.5, r=0.015)
    box(ax, 3.55, 3.35, 2.9, 0.7, "Rules", "30 days · 0.01 ETH · 2 %", fs=8.5, r=0.015)
    box(ax, 6.65, 3.35, 2.9, 0.7, "Events", "Invested · Settled · Refunded", fs=8.5, r=0.015)
    ax.text(0.45, 2.82,
            "escrowed ETH balance  ·  pull payments only  ·  ReentrancyGuard on every transfer",
            fontsize=7.8, color=MID)

    arrow(ax, (1.6, 4.45), (1.6, 4.05), "", ls=(0, (3, 2)))
    arrow(ax, (4.6, 4.05), (4.6, 4.45), "", ls=(0, (3, 2)))

    ax.text(0.15, 2.28, "Actors", fontsize=8.5, color=MID, style="italic")
    box(ax, 0.15, 1.05, 2.9, 0.95, "Investor", "min 0.01 ETH · refund()")
    box(ax, 3.55, 1.05, 2.9, 0.95, "Creator", "createProject() · withdrawFunds()")
    box(ax, 6.95, 1.05, 2.9, 0.95, "Platform", "2 % fee · withdrawPlatformFee()")

    arrow(ax, (1.6, 1.05), (1.6, 2.55), "invest", rad=0.0)
    arrow(ax, (5.0, 1.05), (5.0, 2.55), "create / withdraw", rad=0.0)
    arrow(ax, (8.4, 1.05), (8.4, 2.55), "collect fee", rad=0.0)

    plt.tight_layout(pad=0.2)
    fig.savefig("docs/fig1-architecture.png", dpi=300, facecolor="white")
    plt.close(fig)


def fig2():
    fig, ax = plt.subplots(figsize=(6.5, 3.3))
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 5.4)
    ax.axis("off")

    box(ax, 0.10, 4.15, 2.10, 0.85, "Created", "createProject(T) sets t\u2080", fs=9, bold=True)
    box(ax, 2.60, 4.15, 2.10, 0.85, "Funding", "invest() \u2265 0.01 ETH", fs=9, bold=True)
    box(ax, 5.10, 4.15, 2.10, 0.85, "Settled", "settle() at t \u2265 deadline", fs=9, bold=True)
    box(ax, 7.60, 4.15, 2.30, 0.85, "Closed", "all payouts claimed", fs=9, bold=True)

    arrow(ax, (2.20, 4.57), (2.60, 4.57))
    arrow(ax, (4.70, 4.57), (5.10, 4.57))
    arrow(ax, (7.20, 4.57), (7.60, 4.57))

    box(ax, 5.10, 2.70, 2.10, 0.80, "M \u2265 T", "success = true", fs=9, fill=LIGHT, bold=True)
    box(ax, 5.10, 1.15, 2.10, 0.80, "M < T", "success = false", fs=9, fill=LIGHT, bold=True)
    arrow(ax, (6.15, 4.15), (6.15, 3.50))
    arrow(ax, (6.15, 2.70), (6.15, 1.95))

    box(ax, 0.10, 2.70, 4.15, 0.80, "withdrawFunds() by creator",
        "payout = M \u00d7 98 / 100 \u00b7 fee = M \u00d7 2 / 100", fs=9)
    box(ax, 0.10, 1.15, 4.15, 0.80, "refund() by each investor",
        "R\u1d62 = I\u1d62 \u00b7 100 % principal, no platform fee", fs=9)
    arrow(ax, (5.10, 3.10), (4.25, 3.10))
    arrow(ax, (5.10, 1.55), (4.25, 1.55))

    ax.text(5.0, 0.52,
            "settle() is callable by anyone and is also invoked lazily inside withdrawFunds()\n"
            "and refund(), so no actor can stall a campaign",
            ha="center", fontsize=7.3, color=MID, style="italic")
    ax.text(5.0, 0.16,
            "withdrawPlatformFee() later moves the 2 % pool from the contract to the platform",
            ha="center", fontsize=7.3, color=MID)

    plt.tight_layout(pad=0.2)
    fig.savefig("docs/fig2-flow.png", dpi=300, facecolor="white")
    plt.close(fig)


fig1()
fig2()
print("figures written")

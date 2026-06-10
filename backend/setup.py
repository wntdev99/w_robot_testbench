from setuptools import find_packages, setup

package_name = "w_robot_testbench"

setup(
    name=package_name,
    version="0.1.0",
    packages=find_packages(include=["testbench", "testbench.*"]),
    data_files=[
        ("share/ament_index/resource_index/packages", ["resource/" + package_name]),
        ("share/" + package_name, ["package.xml"]),
    ],
    install_requires=["setuptools"],
    zip_safe=True,
    maintainer="jeongmin.choi",
    maintainer_email="jeongmin.choi@wattrobotics.ai",
    description="웹 기반 ROS2 로봇 테스트벤치 백엔드 (FastAPI + rclpy)",
    license="Apache-2.0",
    entry_points={
        "console_scripts": [
            "testbench = testbench.main:main",
        ],
    },
)

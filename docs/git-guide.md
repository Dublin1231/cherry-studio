# Git 使用指南

## 目录
1. [基础配置](#基础配置)
2. [仓库初始化和克隆](#仓库初始化和克隆)
3. [基本操作](#基本操作)
4. [分支操作](#分支操作)
5. [远程仓库操作](#远程仓库操作)
6. [查看历史](#查看历史)
7. [撤销和回退](#撤销和回退)
8. [暂存操作](#暂存操作)
9. [标签管理](#标签管理)
10. [高级操作](#高级操作)
11. [配置别名](#配置别名)
12. [常用工作流程](#常用工作流程)
13. [维护](#维护)

## 基础配置
```bash
# 设置用户名和邮箱
git config --global user.name "你的名字"
git config --global user.email "你的邮箱"
```

## 仓库初始化和克隆
```bash
# 初始化新仓库
git init

# 克隆远程仓库
git clone <仓库地址>
git clone https://github.com/username/repo.git
```

## 基本操作
```bash
# 查看状态
git status

# 添加文件到暂存区
git add <文件名>     # 添加指定文件
git add .           # 添加所有文件
git add *.js       # 添加所有js文件

# 提交更改
git commit -m "提交说明"
git commit -am "提交说明"  # 合并add和commit（仅对已跟踪文件有效）
```

## 分支操作
```bash
# 查看分支
git branch                  # 查看本地分支
git branch -r              # 查看远程分支
git branch -a              # 查看所有分支

# 创建分支
git branch <分支名>
git checkout -b <分支名>    # 创建并切换到新分支

# 切换分支
git checkout <分支名>
git switch <分支名>         # 新版Git推荐使用

# 合并分支
git merge <分支名>          # 合并指定分支到当前分支
git merge --no-ff <分支名>  # 不使用快进方式合并

# 删除分支
git branch -d <分支名>      # 删除本地分支
git branch -D <分支名>      # 强制删除本地分支
git push origin --delete <分支名>  # 删除远程分支
```

## 远程仓库操作
```bash
# 添加远程仓库
git remote add origin <仓库地址>

# 查看远程仓库
git remote -v

# 推送到远程
git push origin <分支名>
git push -u origin <分支名>  # 首次推送并关联分支
git push --force            # 强制推送（谨慎使用）

# 从远程拉取
git fetch                   # 拉取所有分支
git pull                    # 拉取并合并当前分支
git pull origin <分支名>     # 拉取指定分支
```

## 查看历史
```bash
# 查看提交历史
git log
git log --oneline          # 简洁模式
git log --graph            # 图形化显示
git log -p <文件名>         # 查看指定文件的修改历史

# 查看某次提交
git show <commit_id>
```

## 撤销和回退
```bash
# 撤销工作区修改
git checkout -- <文件名>
git restore <文件名>        # 新版Git推荐使用

# 撤销暂存区修改
git reset HEAD <文件名>
git restore --staged <文件名>  # 新版Git推荐使用

# 回退版本
git reset --soft HEAD^     # 回退到上一个版本，保留工作区修改
git reset --hard HEAD^     # 回退到上一个版本，删除工作区修改
git reset --hard <commit_id>  # 回退到指定提交
```

## 暂存操作
```bash
# 暂存当前修改
git stash
git stash save "备注信息"

# 查看暂存列表
git stash list

# 应用暂存
git stash apply           # 应用最近的暂存
git stash apply stash@{n} # 应用指定的暂存
git stash pop            # 应用并删除最近的暂存

# 删除暂存
git stash drop stash@{n}  # 删除指定暂存
git stash clear          # 清空所有暂存
```

## 标签管理
```bash
# 创建标签
git tag <标签名>
git tag -a <标签名> -m "说明"
git tag -a <标签名> <commit_id>  # 给指定提交打标签

# 查看标签
git tag
git show <标签名>

# 推送标签
git push origin <标签名>
git push origin --tags    # 推送所有标签

# 删除标签
git tag -d <标签名>       # 删除本地标签
git push origin :refs/tags/<标签名>  # 删除远程标签
```

## 高级操作
```bash
# 变基
git rebase <分支名>
git rebase -i HEAD~3     # 交互式变基，修改最近3个提交

# 拣选提交
git cherry-pick <commit_id>  # 将指定提交应用到当前分支

# 子模块
git submodule add <仓库地址>  # 添加子模块
git submodule update --init  # 初始化子模块
git submodule update --recursive  # 更新所有子模块
```

## 配置别名
```bash
git config --global alias.st status
git config --global alias.co checkout
git config --global alias.br branch
git config --global alias.ci commit
git config --global alias.lg "log --color --graph --pretty=format:'%Cred%h%Creset -%C(yellow)%d%Creset %s %Cgreen(%cr) %C(bold blue)<%an>%Creset' --abbrev-commit"
```

## 常用工作流程
```bash
# 功能开发工作流
git checkout -b feature/xxx develop  # 从develop分支创建功能分支
# 开发功能...
git add .
git commit -m "feature: xxx"
git checkout develop
git merge --no-ff feature/xxx
git branch -d feature/xxx
```

## 维护
```bash
# 检查仓库
git fsck

# 压缩仓库
git gc

# 清理未跟踪文件
git clean -n  # 查看会删除哪些文件
git clean -f  # 强制删除未跟踪文件
git clean -fd # 强制删除未跟踪文件和目录
```

## 提交规范
提交信息应该清晰地描述本次更改的内容，建议使用以下格式：

- `feat`: 新功能
- `fix`: 修复bug
- `docs`: 文档更新
- `style`: 代码格式化
- `refactor`: 重构代码
- `test`: 添加测试
- `chore`: 构建过程或辅助工具的变动

示例：
```bash
git commit -m "feat: 添加用户登录功能"
git commit -m "fix: 修复登录验证失败的问题"
git commit -m "docs: 更新API文档"
``` 
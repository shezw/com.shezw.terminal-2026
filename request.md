在当前文件夹创建一个 装修页面
主题是 shezw.com is waiting for furnish 
用一个 index.html 来实现(可配合其他.js) 
主要内容是一个全屏的Terminal 

细节如下:
1. 页面打开的时候，模仿 ubuntu 进入 terminal的欢迎信息，但是内容改成 域名+装修中信息
2. “虚拟系统” 提供以下目录 

```bash
/           # 根目录
/bin        # 支持的指令
    cd      # 进入目录
    ls      # 查看列表 要支持 . ../ 做目录运算
    cat     # 查看文件 
    view    # 以可视化形式阅读(暂时只支持.md即可)
    help    # 查看帮助
    login   # 登陆 交互命令行要求输入账号和密码(暂时不做登陆后实现，将账号密码记录在一个JS字段即可)
    logout  # 退出 退出登陆

/blog       # 博客
    /dev    # 开发
        ios, android, web, backend, cpp, alg, webkit, linux, machine-learning, embedded, python, rtos # 子目录
    /design # 设计
        brand, uiux, illustartion, photograph # 子目录
    /notes      # 日志
    /articles   # 文章

/about      # 关于

/dev        # 开发

```

3. blog目录下，没有子目录时，使用 ls 可以查看文件列表，该命令可以访问 `${hostname}/blog/${dir}/list.md`

该文件的实现效果如下:

```markdown
- git分支切换后提交丢失的问题处理
2152

- python 创建django环境以及结合react作为前端的基础demo
735

- linux安装android sdk
1677

```

此时ls指令通过 get 该文件获取到资源列表，再显示到终端中（此时需要缓存这些名称，用于 cat, view 的自动补足）

4. `cat`, `view` 的功能

当 cat，view 某个文件时，都是通过 GET 访问 `${hostname}/blog/${dir}/list.md` 之后将内容展示到 “虚拟终端中”

其中 cat 按照utf-8展示源文件的内容，view 按照一定视觉可视化来展示(可视化的思路是通过 终端的字体大小颜色等方式来表现 md中的一些特定格式和分隔符等)

空仓库地址：https://github.com/shezw/com.shezw.terminal-2026.git